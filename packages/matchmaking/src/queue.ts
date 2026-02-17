import pino from "pino";
import { QueueEntryModel, type IQueueEntry } from "@alpharena/db";

const logger = pino({ name: "matchmaking-queue" });

export type QueueEntryStatus = "waiting" | "pairing";

export interface QueueEntry {
  agentId: string;
  userId: string;
  eloRating: number;
  stakeAmount: number;
  gameType: string;
  status: QueueEntryStatus;
  joinedAt: Date;
}

export class MatchmakingQueue {
  private entries: QueueEntry[] = [];

  /**
   * Load all pending queue entries from MongoDB into the in-memory array.
   * Called on startup to restore state after a restart.
   */
  async loadFromDatabase(): Promise<void> {
    try {
      const docs = await QueueEntryModel.find({
        status: { $in: ["waiting", "pairing"] },
      }).lean();

      this.entries = docs.map((doc) => ({
        agentId: doc.agentId.toString(),
        userId: doc.userId.toString(),
        eloRating: doc.eloRating,
        stakeAmount: doc.stakeAmount,
        gameType: doc.gameType,
        status: doc.status as QueueEntryStatus,
        joinedAt: doc.joinedAt,
      }));

      logger.info({ count: this.entries.length }, "Loaded queue entries from database");
    } catch (err) {
      logger.error({ err }, "Failed to load queue entries from database");
      throw err;
    }
  }

  /**
   * Add an entry to the in-memory queue and persist it to MongoDB.
   */
  async add(entry: QueueEntry): Promise<void> {
    // Check for duplicate in memory
    const existing = this.entries.find((e) => e.agentId === entry.agentId);
    if (existing) {
      logger.warn({ agentId: entry.agentId }, "Agent is already in the queue");
      throw new Error(`Agent ${entry.agentId} is already in the queue`);
    }

    // Persist to MongoDB
    try {
      await QueueEntryModel.create({
        agentId: entry.agentId,
        userId: entry.userId,
        eloRating: entry.eloRating,
        stakeAmount: entry.stakeAmount,
        gameType: entry.gameType,
        status: entry.status,
        joinedAt: entry.joinedAt,
      });
    } catch (err) {
      logger.error({ err, agentId: entry.agentId }, "Failed to persist queue entry to database");
      throw err;
    }

    // Add to in-memory array
    this.entries.push(entry);
    logger.info(
      { agentId: entry.agentId, gameType: entry.gameType, eloRating: entry.eloRating },
      "Agent added to queue"
    );
  }

  /**
   * Remove an agent from the in-memory queue and delete from MongoDB.
   */
  async remove(agentId: string): Promise<void> {
    const index = this.entries.findIndex((e) => e.agentId === agentId);
    if (index !== -1) {
      this.entries.splice(index, 1);
    }

    try {
      await QueueEntryModel.deleteOne({ agentId });
    } catch (err) {
      logger.error({ err, agentId }, "Failed to remove queue entry from database");
      throw err;
    }

    logger.info({ agentId }, "Agent removed from queue");
  }

  /**
   * Return all waiting entries for a specific game type from the in-memory array.
   */
  getWaiting(gameType: string): QueueEntry[] {
    return this.entries.filter(
      (e) => e.gameType === gameType && e.status === "waiting"
    );
  }

  /**
   * Update the status of an agent's queue entry in memory and MongoDB.
   */
  async setStatus(agentId: string, status: QueueEntryStatus): Promise<void> {
    const entry = this.entries.find((e) => e.agentId === agentId);
    if (entry) {
      entry.status = status;
    }

    try {
      await QueueEntryModel.updateOne({ agentId }, { $set: { status } });
    } catch (err) {
      logger.error({ err, agentId, status }, "Failed to update queue entry status in database");
      throw err;
    }

    logger.debug({ agentId, status }, "Queue entry status updated");
  }

  /**
   * Return the total number of entries currently in the queue.
   */
  size(): number {
    return this.entries.length;
  }

  /**
   * Return a queue entry for a specific agent, or undefined if not found.
   */
  get(agentId: string): QueueEntry | undefined {
    return this.entries.find((e) => e.agentId === agentId);
  }

  /**
   * Return all entries currently in the queue (read-only snapshot).
   */
  getAll(): QueueEntry[] {
    return [...this.entries];
  }

  /**
   * Return the set of distinct game types currently represented in the queue.
   */
  getGameTypes(): string[] {
    const types = new Set<string>();
    for (const entry of this.entries) {
      types.add(entry.gameType);
    }
    return [...types];
  }
}
