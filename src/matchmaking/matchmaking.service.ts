import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MatchmakingQueue, QueueEntryData } from './matchmaking.queue';
import { findPairs, findPokerGroup } from './pairing';
import { Agent } from '../database/schemas';
import { MATCHMAKING_INTERVAL_MS, MATCHMAKING_COUNTDOWN_MS } from '../common/constants/game.constants';
import { OrchestratorService } from '../orchestrator/orchestrator.service';
import { EventBusService } from '../orchestrator/event-bus.service';

@Injectable()
export class MatchmakingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private onPairedCallback: ((agentA: string, agentB: string, stakeAmount: number, gameType: string, token?: string) => Promise<string>) | null = null;
  private onMultiMatchCallback: ((agentIds: string[], stakeAmount: number, gameType: string, token?: string) => Promise<string>) | null = null;
  private readonly countdowns = new Map<string, { startedAt: number }>();

  constructor(
    private readonly queue: MatchmakingQueue,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly orchestrator: OrchestratorService,
    private readonly eventBus: EventBusService,
  ) {}

  async onModuleInit() {
    await this.queue.loadFromDatabase();

    this.setOnPairedCallback(async (agentAId, agentBId, stakeAmount, gameType, token) => {
      const [agentA, agentB] = await Promise.all([
        this.agentModel.findById(agentAId),
        this.agentModel.findById(agentBId),
      ]);
      if (!agentA || !agentB) throw new Error(`Agent not found: A=${agentAId}, B=${agentBId}`);

      return this.orchestrator.startMatch(
        {
          agentId: agentA._id.toString(),
          userId: agentA.userId.toString(),
          name: agentA.name,
          endpointUrl: agentA.endpointUrl ?? '',
          eloRating: agentA.eloRating,
          type: agentA.type,
          chain: agentA.chain,
          token,
          openclawUrl: agentA.openclawUrl,
          openclawToken: agentA.openclawToken,
          openclawAgentId: agentA.openclawAgentId,
        },
        {
          agentId: agentB._id.toString(),
          userId: agentB.userId.toString(),
          name: agentB.name,
          endpointUrl: agentB.endpointUrl ?? '',
          eloRating: agentB.eloRating,
          type: agentB.type,
          chain: agentB.chain,
          token,
          openclawUrl: agentB.openclawUrl,
          openclawToken: agentB.openclawToken,
          openclawAgentId: agentB.openclawAgentId,
        },
        stakeAmount,
        gameType,
      );
    });

    // Multi-agent callback for poker (N players)
    this.onMultiMatchCallback = async (agentIds, stakeAmount, gameType, token) => {
      const agentDocs = await Promise.all(agentIds.map(id => this.agentModel.findById(id)));
      const agents = agentDocs.filter(Boolean).map(a => ({
        agentId: a!._id.toString(),
        userId: a!.userId.toString(),
        name: a!.name,
        endpointUrl: a!.endpointUrl ?? '',
        eloRating: a!.eloRating,
        type: a!.type,
        chain: a!.chain,
        token,
        openclawUrl: a!.openclawUrl,
        openclawToken: a!.openclawToken,
        openclawAgentId: a!.openclawAgentId,
      }));
      if (agents.length < 2) throw new Error('Not enough valid agents');
      return this.orchestrator.startMatchMulti(agents, stakeAmount, gameType);
    };

    this.logger.log(`Matchmaking service started, queue size: ${this.queue.size()}`);
    this.intervalId = setInterval(() => { void this.processPairing(); }, MATCHMAKING_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.countdowns.clear();
    this.logger.log('Matchmaking service stopped');
  }

  setOnPairedCallback(cb: (agentA: string, agentB: string, stakeAmount: number, gameType: string, token?: string) => Promise<string>) {
    this.onPairedCallback = cb;
  }

  async joinQueue(agentId: string, userId: string, eloRating: number, stakeAmount: number, gameType: string, agentType?: string, token?: string): Promise<void> {
    const entry: QueueEntryData = { agentId, userId, eloRating, stakeAmount, gameType, status: 'waiting', joinedAt: new Date(), agentType, token };
    await this.queue.add(entry);
    this.logger.log(`Agent ${agentId} joined matchmaking queue`);
  }

  async leaveQueue(agentId: string): Promise<void> {
    await this.queue.remove(agentId);
    this.logger.log(`Agent ${agentId} left matchmaking queue`);
  }

  async getQueueStatus(agentId: string): Promise<QueueEntryData | undefined> {
    return this.queue.get(agentId);
  }

  async getQueueSize(gameType?: string): Promise<number> {
    if (gameType) return this.queue.getWaiting(gameType).length;
    return this.queue.size();
  }

  getQueueEntries(gameType?: string): QueueEntryData[] {
    const all = this.queue.getAll();
    if (gameType) return all.filter((e) => e.gameType === gameType);
    return all;
  }

  private emitCountdown(gameType: string, remainingMs: number, waiting: QueueEntryData[]): void {
    this.eventBus.emit('matchmaking:countdown', {
      gameType,
      remainingMs,
      agents: waiting.map((e) => ({ agentId: e.agentId, eloRating: e.eloRating })),
    });
  }

  private async processPairing(): Promise<void> {
    if (this.processing || !this.onPairedCallback) return;
    this.processing = true;

    try {
      const gameTypes = this.queue.getGameTypes();

      // Cancel countdowns for game types that no longer have enough agents
      for (const [gameType, _countdown] of this.countdowns) {
        const waiting = this.queue.getWaiting(gameType);
        if (waiting.length < 2) {
          this.logger.log(`Countdown cancelled for ${gameType} — not enough agents`);
          this.countdowns.delete(gameType);
        }
      }

      for (const gameType of gameTypes) {
        const waiting = this.queue.getWaiting(gameType);
        if (waiting.length < 2) continue;

        // Poker: use multi-agent grouping (2-9 players)
        if (gameType === 'poker' && this.onMultiMatchCallback) {
          const group = findPokerGroup(waiting);
          if (!group || group.length < 2) continue;

          // Poker always uses countdown to wait for more players (up to 9)
          {
            const countdown = this.countdowns.get(gameType);
            const now = Date.now();
            if (!countdown) {
              this.countdowns.set(gameType, { startedAt: now });
              this.logger.log(`Poker countdown started with ${waiting.length} agents`);
              this.emitCountdown(gameType, MATCHMAKING_COUNTDOWN_MS, waiting);
              continue;
            }
            const remaining = MATCHMAKING_COUNTDOWN_MS - (now - countdown.startedAt);
            if (remaining > 0) { this.emitCountdown(gameType, remaining, waiting); continue; }
            this.countdowns.delete(gameType);
            this.logger.log(`Poker countdown expired, creating match with ${group.length} players`);
          }

          try {
            for (const entry of group) await this.queue.setStatus(entry.agentId, 'pairing');
            const stakeAmount = Math.min(...group.map(e => e.stakeAmount));
            const token = group[0].token || 'ALPHA';
            const matchId = await this.onMultiMatchCallback(group.map(e => e.agentId), stakeAmount, gameType, token);
            this.eventBus.emit('matchmaking:matched', { matchId, gameType, agents: group.map(e => e.agentId) });
            for (const entry of group) await this.queue.remove(entry.agentId);
          } catch (err) {
            this.logger.error(`Failed to create poker match: ${err}`);
            for (const entry of group) {
              try { await this.queue.setStatus(entry.agentId, 'waiting'); } catch {}
            }
          }
          continue;
        }

        // Chess/other: pair 2 agents
        const pairs = findPairs(waiting);
        if (pairs.length === 0) continue;

        if (waiting.length === 2 && pairs.length === 1) {
          this.countdowns.delete(gameType);
          this.logger.log(`Instant pairing for ${gameType} — exactly 2 agents`);
        } else {
          const countdown = this.countdowns.get(gameType);
          const now = Date.now();

          if (!countdown) {
            // Start a new countdown
            this.countdowns.set(gameType, { startedAt: now });
            this.logger.log(`Countdown started for ${gameType} with ${waiting.length} agents`);
            this.emitCountdown(gameType, MATCHMAKING_COUNTDOWN_MS, waiting);
            continue;
          }

          const elapsed = now - countdown.startedAt;
          const remainingMs = MATCHMAKING_COUNTDOWN_MS - elapsed;

          if (remainingMs > 0) {
            // Countdown still active — emit tick
            this.emitCountdown(gameType, remainingMs, waiting);
            continue;
          }

          // Countdown expired — run pairing on the full pool
          this.countdowns.delete(gameType);
          this.logger.log(`Countdown expired for ${gameType}, pairing ${pairs.length} pair(s)`);
        }

        for (const [entryA, entryB] of pairs) {
          try {
            await this.queue.setStatus(entryA.agentId, 'pairing');
            await this.queue.setStatus(entryB.agentId, 'pairing');
            const stakeAmount = Math.min(entryA.stakeAmount, entryB.stakeAmount);
            const token = entryA.token || entryB.token || 'ALPHA';
            const matchId = await this.onPairedCallback(entryA.agentId, entryB.agentId, stakeAmount, gameType, token);
            this.eventBus.emit('matchmaking:matched', {
              matchId,
              gameType,
              agents: [entryA.agentId, entryB.agentId],
            });
            await this.queue.remove(entryA.agentId);
            await this.queue.remove(entryB.agentId);
          } catch (err) {
            this.logger.error(`Failed to create match for pair: ${err}`);
            try {
              await this.queue.setStatus(entryA.agentId, 'waiting');
              await this.queue.setStatus(entryB.agentId, 'waiting');
            } catch (resetErr) {
              this.logger.error(`Failed to reset queue entry status: ${resetErr}`);
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Error during pairing cycle: ${err}`);
    } finally {
      this.processing = false;
    }
  }
}
