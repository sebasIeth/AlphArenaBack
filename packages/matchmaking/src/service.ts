import pino from "pino";
import { MATCHMAKING_INTERVAL_MS } from "@alpharena/shared";
import { MatchmakingQueue, type QueueEntry } from "./queue.js";
import { findPairs } from "./pairing.js";

const logger = pino({ name: "matchmaking-service" });

export interface MatchmakingServiceOptions {
  queue: MatchmakingQueue;
  onPaired: (
    agentA: string,
    agentB: string,
    stakeAmount: number,
    gameType: string
  ) => Promise<string>;
}

export class MatchmakingService {
  private readonly queue: MatchmakingQueue;
  private readonly onPaired: MatchmakingServiceOptions["onPaired"];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(options: MatchmakingServiceOptions) {
    this.queue = options.queue;
    this.onPaired = options.onPaired;
  }

  /**
   * Start the matchmaking service.
   * Loads existing queue entries from the database and begins the
   * periodic pairing interval.
   */
  async start(): Promise<void> {
    await this.queue.loadFromDatabase();
    logger.info(
      { queueSize: this.queue.size(), intervalMs: MATCHMAKING_INTERVAL_MS },
      "Matchmaking service started"
    );

    this.intervalId = setInterval(() => {
      void this.processPairing();
    }, MATCHMAKING_INTERVAL_MS);
  }

  /**
   * Stop the matchmaking service by clearing the pairing interval.
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info("Matchmaking service stopped");
  }

  /**
   * Add an agent to the matchmaking queue.
   */
  async joinQueue(
    agentId: string,
    userId: string,
    eloRating: number,
    stakeAmount: number,
    gameType: string
  ): Promise<void> {
    const entry: QueueEntry = {
      agentId,
      userId,
      eloRating,
      stakeAmount,
      gameType,
      status: "waiting",
      joinedAt: new Date(),
    };

    await this.queue.add(entry);
    logger.info(
      { agentId, gameType, eloRating, stakeAmount },
      "Agent joined matchmaking queue"
    );
  }

  /**
   * Remove an agent from the matchmaking queue.
   */
  async leaveQueue(agentId: string): Promise<void> {
    await this.queue.remove(agentId);
    logger.info({ agentId }, "Agent left matchmaking queue");
  }

  /**
   * Return the queue entry for a specific agent, or undefined if not in queue.
   */
  async getQueueStatus(agentId: string): Promise<QueueEntry | undefined> {
    return this.queue.get(agentId);
  }

  /**
   * Return the current queue size, optionally filtered by game type.
   */
  async getQueueSize(gameType?: string): Promise<number> {
    if (gameType) {
      return this.queue.getWaiting(gameType).length;
    }
    return this.queue.size();
  }

  /**
   * Run one pairing cycle: gather waiting entries for each game type,
   * find valid pairs, and invoke the onPaired callback for each pair.
   */
  private async processPairing(): Promise<void> {
    // Prevent overlapping processing cycles
    if (this.processing) return;
    this.processing = true;

    try {
      const gameTypes = this.queue.getGameTypes();

      for (const gameType of gameTypes) {
        const waiting = this.queue.getWaiting(gameType);

        if (waiting.length < 2) continue;

        const pairs = findPairs(waiting);

        if (pairs.length === 0) continue;

        logger.info(
          { gameType, waitingCount: waiting.length, pairsFound: pairs.length },
          "Pairs found for game type"
        );

        for (const [entryA, entryB] of pairs) {
          try {
            // Mark both entries as pairing to prevent double-matching
            await this.queue.setStatus(entryA.agentId, "pairing");
            await this.queue.setStatus(entryB.agentId, "pairing");

            // Use the lower of the two stake amounts as the match stake
            const stakeAmount = Math.min(entryA.stakeAmount, entryB.stakeAmount);

            // Invoke the callback to create the match
            const matchId = await this.onPaired(
              entryA.agentId,
              entryB.agentId,
              stakeAmount,
              gameType
            );

            logger.info(
              {
                matchId,
                agentA: entryA.agentId,
                agentB: entryB.agentId,
                gameType,
                stakeAmount,
              },
              "Match created from pairing"
            );

            // Remove paired agents from the queue
            await this.queue.remove(entryA.agentId);
            await this.queue.remove(entryB.agentId);
          } catch (err) {
            logger.error(
              {
                err,
                agentA: entryA.agentId,
                agentB: entryB.agentId,
                gameType,
              },
              "Failed to create match for pair"
            );

            // Reset status back to waiting so they can be retried
            try {
              await this.queue.setStatus(entryA.agentId, "waiting");
              await this.queue.setStatus(entryB.agentId, "waiting");
            } catch (resetErr) {
              logger.error(
                { err: resetErr, agentA: entryA.agentId, agentB: entryB.agentId },
                "Failed to reset queue entry status after pairing failure"
              );
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error during pairing cycle");
    } finally {
      this.processing = false;
    }
  }
}
