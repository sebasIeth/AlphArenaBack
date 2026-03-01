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
import { MatchEndedEvent, MatchErrorEvent } from '../common/types/events.types';
import { SettlementService } from '../settlement/settlement.service';

@Injectable()
export class AutoPlayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoPlayService.name);
  private readonly requeueTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly eventBus: EventBusService,
    private readonly matchmakingService: MatchmakingService,
    private readonly settlement: SettlementService,
  ) {}

  onModuleInit() {
    this.eventBus.on('match:ended', (data: MatchEndedEvent) => this.handleMatchEnded(data));
    this.eventBus.on('match:error', (data: MatchErrorEvent) => this.handleMatchError(data));
    this.bootstrapAutoPlayAgents();
  }

  onModuleDestroy() {
    for (const timer of this.requeueTimers.values()) {
      clearTimeout(timer);
    }
    this.requeueTimers.clear();
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

    // Prioritize chess if agent supports it
    const gameType = agent.gameTypes.includes('chess') ? 'chess' : agent.gameTypes[0];
    if (!gameType) {
      this.logger.warn(`Auto-play re-queue: agent ${agentId} has no game types`);
      return;
    }

    const stakeAmount = MIN_STAKE;

    // Verify on-chain balance before queuing
    if (agent.walletAddress) {
      const balance = await this.settlement.getAgentUsdcBalance(agent.walletAddress);
      if (parseFloat(balance) < stakeAmount) {
        this.logger.warn(
          `Auto-play: agent ${agentId} has insufficient balance (${balance}) for stake ${stakeAmount}. Disabling auto-play.`,
        );
        await this.agentModel.updateOne({ _id: agentId }, { $set: { autoPlay: false } });
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
