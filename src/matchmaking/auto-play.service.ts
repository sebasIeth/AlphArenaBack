import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from '../database/schemas';
import { EventBusService } from '../orchestrator/event-bus.service';
import { MatchmakingService } from './matchmaking.service';
import {
  AUTO_PLAY_REQUEUE_DELAY_MS,
  AUTO_PLAY_MAX_CONSECUTIVE_ERRORS,
  MIN_STAKE,
} from '../common/constants/game.constants';
import { MatchEndedEvent, MatchErrorEvent, MatchmakingQueueJoinedEvent } from '../common/types/events.types';
import { SettlementService } from '../settlement/settlement.service';

@Injectable()
export class AutoPlayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoPlayService.name);
  private readonly requeueTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly recruitmentTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly eventBus: EventBusService,
    private readonly matchmakingService: MatchmakingService,
    private readonly settlement: SettlementService,
  ) {}

  onModuleInit() {
    this.eventBus.on('match:ended', (data: MatchEndedEvent) => this.handleMatchEnded(data));
    this.eventBus.on('match:error', (data: MatchErrorEvent) => this.handleMatchError(data));
    this.eventBus.on('matchmaking:queue_joined', (data: MatchmakingQueueJoinedEvent) => this.handleQueueJoined(data));
    this.eventBus.on('matchmaking:matched', (data: { gameType: string }) => this.cancelRecruitmentRetry(data.gameType));
    this.bootstrapAutoPlayAgents();
  }

  onModuleDestroy() {
    for (const timer of this.requeueTimers.values()) {
      clearTimeout(timer);
    }
    this.requeueTimers.clear();
    for (const timer of this.recruitmentTimers.values()) {
      clearTimeout(timer);
    }
    this.recruitmentTimers.clear();
  }

  private async bootstrapAutoPlayAgents(): Promise<void> {
    try {
      // Find stuck queued agents (autoPlay=true) and clean them up
      // Note: in_match agents are NOT reset here — match recovery handles them
      const stuckAgents = await this.agentModel.find({
        autoPlay: true,
        status: 'queued',
      });

      for (const agent of stuckAgents) {
        // Remove from matchmaking queue if present (clears both in-memory and DB)
        try {
          await this.matchmakingService.leaveQueue(agent._id.toString());
        } catch {}
      }

      if (stuckAgents.length > 0) {
        await this.agentModel.updateMany(
          { _id: { $in: stuckAgents.map((a) => a._id) } },
          { $set: { status: 'idle' } },
        );
        this.logger.log(`Reset ${stuckAgents.length} stuck queued auto-play agents to idle`);
      }

      // Ensure all non-human agents support poker (backfill for existing agents)
      const backfillResult = await this.agentModel.updateMany(
        { type: { $ne: 'human' }, gameTypes: { $nin: ['poker'] } },
        { $addToSet: { gameTypes: 'poker' } },
      );
      if (backfillResult.modifiedCount > 0) {
        this.logger.log(`Added poker support to ${backfillResult.modifiedCount} agents`);
      }

      // Find all idle auto-play agents and schedule re-queue with staggered delays
      // Skip human agents — they are controlled by the user via /play endpoints
      const agents = await this.agentModel.find({
        autoPlay: true,
        type: { $ne: 'human' },
        status: 'idle',
        autoPlayConsecutiveErrors: { $lt: AUTO_PLAY_MAX_CONSECUTIVE_ERRORS },
      });

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const delay = AUTO_PLAY_REQUEUE_DELAY_MS + i * 2_000; // stagger by 2s each
        this.scheduleRequeue(agent._id.toString(), delay);
      }

      if (agents.length > 0) {
        this.logger.log(`Scheduled re-queue for ${agents.length} auto-play agents on startup`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to bootstrap auto-play agents: ${message}`);
    }
  }

  private async handleMatchEnded(data: MatchEndedEvent): Promise<void> {
    const { agentIds } = data;

    for (const agentId of [agentIds.a, agentIds.b]) {
      try {
        await this.agentModel.updateOne(
          { _id: agentId, autoPlay: true },
          { $set: { autoPlayConsecutiveErrors: 0 } },
        );
        const agent = await this.agentModel.findById(agentId);
        if (agent?.autoPlay) {
          this.scheduleRequeue(agentId);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to handle match:ended for agent ${agentId}: ${message}`);
      }
    }
  }

  private async handleMatchError(data: MatchErrorEvent): Promise<void> {
    if (!data.agentIds) return;
    const { agentIds } = data;

    for (const agentId of [agentIds.a, agentIds.b]) {
      try {
        const agent = await this.agentModel.findOneAndUpdate(
          { _id: agentId, autoPlay: true },
          { $inc: { autoPlayConsecutiveErrors: 1 } },
          { new: true },
        );

        if (!agent) continue;

        if (agent.autoPlayConsecutiveErrors >= AUTO_PLAY_MAX_CONSECUTIVE_ERRORS) {
          await this.agentModel.updateOne(
            { _id: agentId },
            { $set: { autoPlay: false } },
          );
          this.cancelPendingRequeue(agentId);
          this.logger.warn(
            `Auto-play disabled for agent ${agentId} after ${AUTO_PLAY_MAX_CONSECUTIVE_ERRORS} consecutive errors`,
          );
        } else {
          this.scheduleRequeue(agentId);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to handle match:error for agent ${agentId}: ${message}`);
      }
    }
  }

  private async handleQueueJoined(data: MatchmakingQueueJoinedEvent): Promise<void> {
    // When a human player joins a queue, recruit an idle auto-play bot for the same gameType
    if (data.agentType !== 'human') return;

    try {
      const waiting = await this.matchmakingService.getQueueSize(data.gameType);
      // Only recruit if the human is alone (no opponent yet)
      if (waiting > 1) return;

      await this.recruitForGameType(data.gameType);

      // Check if recruitment succeeded (queue now has 2+ entries)
      const afterWaiting = await this.matchmakingService.getQueueSize(data.gameType);
      if (afterWaiting < 2) {
        this.scheduleRecruitmentRetry(data.gameType);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to recruit for ${data.gameType}: ${message}`);
      this.scheduleRecruitmentRetry(data.gameType);
    }
  }

  private scheduleRecruitmentRetry(gameType: string): void {
    this.cancelRecruitmentRetry(gameType);
    const timer = setTimeout(async () => {
      this.recruitmentTimers.delete(gameType);
      try {
        const waiting = await this.matchmakingService.getQueueSize(gameType);
        if (waiting < 1 || waiting > 1) return; // No one waiting or already has opponent

        this.logger.log(`Retrying bot recruitment for ${gameType}`);
        await this.recruitForGameType(gameType);

        const afterWaiting = await this.matchmakingService.getQueueSize(gameType);
        if (afterWaiting < 2) {
          this.scheduleRecruitmentRetry(gameType); // Keep retrying
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Recruitment retry failed for ${gameType}: ${message}`);
        this.scheduleRecruitmentRetry(gameType);
      }
    }, 5_000);
    this.recruitmentTimers.set(gameType, timer);
  }

  private cancelRecruitmentRetry(gameType: string): void {
    const timer = this.recruitmentTimers.get(gameType);
    if (timer) {
      clearTimeout(timer);
      this.recruitmentTimers.delete(gameType);
    }
  }

  private async recruitForGameType(gameType: string): Promise<void> {
    // 1. Try idle auto-play agents (iterate through all to handle balance failures)
    const idleAgents = await this.agentModel.find({
      autoPlay: true,
      type: { $ne: 'human' },
      status: 'idle',
      gameTypes: gameType,
      autoPlayConsecutiveErrors: { $lt: AUTO_PLAY_MAX_CONSECUTIVE_ERRORS },
    });

    for (const agent of idleAgents) {
      const agentId = agent._id.toString();
      this.logger.log(`Recruiting idle auto-play agent ${agentId} for ${gameType}`);
      this.cancelPendingRequeue(agentId);
      const success = await this.requeueAgentForGameType(agentId, gameType);
      if (success) return;
    }

    // 2. If none idle, steal one already queued for a DIFFERENT gameType
    const queueEntries = this.matchmakingService.getQueueEntries();
    for (const entry of queueEntries) {
      if (entry.gameType === gameType) continue;
      if (entry.agentType === 'human') continue;

      const candidate = await this.agentModel.findOne({
        _id: entry.agentId,
        autoPlay: true,
        type: { $ne: 'human' },
        gameTypes: gameType,
      });

      if (candidate) {
        this.logger.log(`Stealing auto-play agent ${entry.agentId} from ${entry.gameType} queue for ${gameType}`);
        await this.matchmakingService.leaveQueue(entry.agentId);
        candidate.status = 'idle';
        await candidate.save();

        const agentId = candidate._id.toString();
        this.cancelPendingRequeue(agentId);
        const success = await this.requeueAgentForGameType(agentId, gameType);
        if (success) return;
      }
    }

    // 3. Fallback: recruit any idle non-human bot (even with autoPlay=false)
    //    Re-enable autoPlay so it can be queued for this game
    const fallbackAgent = await this.agentModel.findOne({
      type: { $ne: 'human' },
      status: 'idle',
      gameTypes: gameType,
    });

    if (fallbackAgent) {
      const agentId = fallbackAgent._id.toString();
      this.logger.log(`Fallback recruiting agent ${agentId} for ${gameType} (re-enabling autoPlay)`);
      await this.agentModel.updateOne({ _id: agentId }, { $set: { autoPlay: true, autoPlayConsecutiveErrors: 0 } });
      this.cancelPendingRequeue(agentId);
      const success = await this.requeueAgentForGameType(agentId, gameType);
      if (success) return;
    }

    this.logger.warn(`No auto-play agent available for ${gameType}`);
  }

  private async requeueAgentForGameType(agentId: string, gameType: string): Promise<boolean> {
    const agent = await this.agentModel.findById(agentId);
    if (!agent || !agent.autoPlay || agent.type === 'human' || agent.status !== 'idle') return false;
    if (!agent.gameTypes.includes(gameType)) return false;

    const stakeAmount = MIN_STAKE;

    if (agent.walletAddress) {
      const balance = await this.settlement.getAgentAlphaBalance(agent.walletAddress);
      if (parseFloat(balance) < stakeAmount) {
        this.logger.warn(`Auto-play recruit: agent ${agentId} has insufficient balance (${balance}), skipping`);
        return false;
      }
    }

    try {
      agent.status = 'queued';
      await agent.save();

      await this.matchmakingService.joinQueue(
        agentId,
        agent.userId.toString(),
        agent.eloRating,
        stakeAmount,
        gameType,
        agent.type,
      );

      this.logger.log(`Auto-play: agent ${agentId} recruited for ${gameType} (stake=${stakeAmount})`);
      return true;
    } catch (error: unknown) {
      try {
        await this.agentModel.updateOne({ _id: agentId }, { $set: { status: 'idle' } });
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Auto-play recruit failed for agent ${agentId}: ${message}`);
      return false;
    }
  }

  scheduleRequeue(agentId: string, delayMs: number = AUTO_PLAY_REQUEUE_DELAY_MS): void {
    this.cancelPendingRequeue(agentId);
    const timer = setTimeout(() => {
      this.requeueTimers.delete(agentId);
      this.requeueAgent(agentId).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to re-queue agent ${agentId}: ${message}`);
      });
    }, delayMs);
    this.requeueTimers.set(agentId, timer);
  }

  cancelPendingRequeue(agentId: string): void {
    const timer = this.requeueTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.requeueTimers.delete(agentId);
    }
  }

  private async requeueAgent(agentId: string): Promise<void> {
    const agent = await this.agentModel.findById(agentId);
    if (!agent) {
      this.logger.warn(`Auto-play re-queue: agent ${agentId} not found`);
      return;
    }

    if (!agent.autoPlay) return;
    if (agent.type === 'human') return;
    if (agent.status !== 'idle') return;
    if (agent.status === ('disabled' as string)) return;
    if (agent.autoPlayConsecutiveErrors >= AUTO_PLAY_MAX_CONSECUTIVE_ERRORS) return;

    // Pick the game type with the most waiting players (demand-based),
    // falling back to a round-robin across supported types.
    const supportedTypes: string[] = agent.gameTypes ?? [];
    if (supportedTypes.length === 0) {
      this.logger.warn(`Auto-play re-queue: agent ${agentId} has no game types`);
      return;
    }

    let gameType: string = supportedTypes[0];
    let maxWaiting = -1;
    for (const gt of supportedTypes) {
      const waitingCount = await this.matchmakingService.getQueueSize(gt);
      if (waitingCount > maxWaiting) {
        maxWaiting = waitingCount;
        gameType = gt;
      }
    }

    // If no queue has waiting players, fall back to random supported type
    if (maxWaiting <= 0) {
      gameType = supportedTypes[Math.floor(Math.random() * supportedTypes.length)];
    }

    const stakeAmount = MIN_STAKE;

    // Verify on-chain balance before queuing
    if (agent.walletAddress) {
      const balance = await this.settlement.getAgentAlphaBalance(agent.walletAddress);
      if (parseFloat(balance) < stakeAmount) {
        this.logger.warn(
          `Auto-play: agent ${agentId} has insufficient balance (${balance}) for stake ${stakeAmount}. Retrying later.`,
        );
        this.scheduleRequeue(agentId, 30_000);
        return;
      }
    }

    try {
      agent.status = 'queued';
      await agent.save();

      await this.matchmakingService.joinQueue(
        agentId,
        agent.userId.toString(),
        agent.eloRating,
        stakeAmount,
        gameType,
        agent.type,
      );

      this.logger.log(`Auto-play: agent ${agentId} re-queued for ${gameType} (stake=${stakeAmount})`);
    } catch (error: unknown) {
      // Revert status on failure
      try {
        await this.agentModel.updateOne({ _id: agentId }, { $set: { status: 'idle' } });
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Auto-play re-queue failed for agent ${agentId}: ${message}`);
    }
  }
}
