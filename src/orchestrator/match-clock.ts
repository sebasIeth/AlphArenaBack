import { Logger } from '@nestjs/common';
import { MATCH_DURATION_MS, TURN_TIMEOUT_MS } from '../common/constants/game.constants';

export interface MatchClockCallbacks {
  onMatchTimeout: (matchId: string) => void;
  onTurnTimeout: (matchId: string) => void;
}

export class MatchClock {
  private readonly logger = new Logger(MatchClock.name);
  private readonly matchId: string;
  private readonly matchDurationMs: number;
  private readonly turnTimeoutMs: number;
  private readonly callbacks: MatchClockCallbacks;
  private matchTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private matchStartedAt: number = 0;

  private readonly elapsedMs: number;

  constructor(
    matchId: string,
    callbacks: MatchClockCallbacks,
    matchDurationMs: number = MATCH_DURATION_MS,
    turnTimeoutMs: number = TURN_TIMEOUT_MS,
    elapsedMs: number = 0,
  ) {
    this.matchId = matchId;
    this.callbacks = callbacks;
    this.matchDurationMs = matchDurationMs;
    this.turnTimeoutMs = turnTimeoutMs;
    this.elapsedMs = elapsedMs;
  }

  startMatch(): void {
    this.matchStartedAt = Date.now() - this.elapsedMs;
    const remainingMs = Math.max(0, this.matchDurationMs - this.elapsedMs);
    this.logger.log(`Match clock started for ${this.matchId} (${remainingMs}ms remaining)`);
    this.matchTimer = setTimeout(() => {
      this.logger.warn(`Match timer expired for ${this.matchId}`);
      this.callbacks.onMatchTimeout(this.matchId);
    }, remainingMs);
  }

  startTurn(): number {
    this.clearTurn();
    const deadline = Date.now() + this.turnTimeoutMs;
    this.turnTimer = setTimeout(() => {
      this.logger.warn(`Turn timer expired for ${this.matchId}`);
      this.callbacks.onTurnTimeout(this.matchId);
    }, this.turnTimeoutMs);
    return deadline;
  }

  clearTurn(): void {
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  stop(): void {
    if (this.matchTimer !== null) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    this.clearTurn();
    this.logger.log(`Match clock stopped for ${this.matchId}`);
  }

  getTimeRemainingMs(): number {
    if (this.matchStartedAt === 0) return 0;
    const elapsed = Date.now() - this.matchStartedAt;
    return Math.max(0, this.matchDurationMs - elapsed);
  }
}
