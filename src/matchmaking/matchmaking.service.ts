import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MatchmakingQueue, QueueEntryData } from './matchmaking.queue';
import { findPairs } from './pairing';
import { Agent } from '../database/schemas';
import { MATCHMAKING_INTERVAL_MS } from '../common/constants/game.constants';

@Injectable()
export class MatchmakingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchmakingService.name);
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private onPairedCallback: ((agentA: string, agentB: string, stakeAmount: number, gameType: string) => Promise<string>) | null = null;

  constructor(
    private readonly queue: MatchmakingQueue,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  async onModuleInit() {
    await this.queue.loadFromDatabase();
    this.logger.log(`Matchmaking service started, queue size: ${this.queue.size()}`);
    this.intervalId = setInterval(() => { void this.processPairing(); }, MATCHMAKING_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.logger.log('Matchmaking service stopped');
  }

  setOnPairedCallback(cb: (agentA: string, agentB: string, stakeAmount: number, gameType: string) => Promise<string>) {
    this.onPairedCallback = cb;
  }

  async joinQueue(agentId: string, userId: string, eloRating: number, stakeAmount: number, gameType: string): Promise<void> {
    const entry: QueueEntryData = { agentId, userId, eloRating, stakeAmount, gameType, status: 'waiting', joinedAt: new Date() };
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

  private async processPairing(): Promise<void> {
    if (this.processing || !this.onPairedCallback) return;
    this.processing = true;

    try {
      const gameTypes = this.queue.getGameTypes();
      for (const gameType of gameTypes) {
        const waiting = this.queue.getWaiting(gameType);
        if (waiting.length < 2) continue;
        const pairs = findPairs(waiting);
        if (pairs.length === 0) continue;

        this.logger.log(`Found ${pairs.length} pairs for ${gameType}`);

        for (const [entryA, entryB] of pairs) {
          try {
            await this.queue.setStatus(entryA.agentId, 'pairing');
            await this.queue.setStatus(entryB.agentId, 'pairing');
            const stakeAmount = Math.min(entryA.stakeAmount, entryB.stakeAmount);
            await this.onPairedCallback(entryA.agentId, entryB.agentId, stakeAmount, gameType);
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
