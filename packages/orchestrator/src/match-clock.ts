import { MATCH_DURATION_MS, TURN_TIMEOUT_MS } from "@alpharena/shared";
import pino from "pino";

const logger = pino({ name: "orchestrator:match-clock" });

/**
 * Callback signatures for clock expiration events.
 */
export interface MatchClockCallbacks {
  /** Called when the overall match timer expires. */
  onMatchTimeout: (matchId: string) => void;
  /** Called when the per-turn timer expires. */
  onTurnTimeout: (matchId: string) => void;
}

/**
 * MatchClock manages two levels of timer for a single match:
 *
 * 1. **Match timer** - An overall countdown for the entire match.
 *    When this expires, the match ends immediately (the side with more
 *    pieces wins; on a tie the most-recent mover wins).
 *
 * 2. **Turn timer** - A per-turn countdown reset on every new turn.
 *    When this expires, the current player is charged a timeout.
 */
export class MatchClock {
  private readonly matchId: string;
  private readonly matchDurationMs: number;
  private readonly turnTimeoutMs: number;
  private readonly callbacks: MatchClockCallbacks;

  /** The setTimeout handle for the overall match timer. */
  private matchTimer: ReturnType<typeof setTimeout> | null = null;

  /** The setTimeout handle for the current turn timer. */
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  /** Unix timestamp (ms) when the match timer was started. */
  private matchStartedAt: number = 0;

  constructor(
    matchId: string,
    callbacks: MatchClockCallbacks,
    matchDurationMs: number = MATCH_DURATION_MS,
    turnTimeoutMs: number = TURN_TIMEOUT_MS,
  ) {
    this.matchId = matchId;
    this.callbacks = callbacks;
    this.matchDurationMs = matchDurationMs;
    this.turnTimeoutMs = turnTimeoutMs;
  }

  /**
   * Start the overall match timer.
   * When the timer expires, `onMatchTimeout` is invoked.
   */
  startMatch(): void {
    this.matchStartedAt = Date.now();

    logger.info(
      { matchId: this.matchId, durationMs: this.matchDurationMs },
      "Match clock started",
    );

    this.matchTimer = setTimeout(() => {
      logger.warn({ matchId: this.matchId }, "Match timer expired");
      this.callbacks.onMatchTimeout(this.matchId);
    }, this.matchDurationMs);
  }

  /**
   * Start the per-turn timer.
   * Clears any existing turn timer before starting a new one.
   *
   * @returns The deadline timestamp (Unix ms) by which the turn must complete.
   */
  startTurn(): number {
    this.clearTurn();

    const deadline = Date.now() + this.turnTimeoutMs;

    logger.debug(
      { matchId: this.matchId, deadline, timeoutMs: this.turnTimeoutMs },
      "Turn timer started",
    );

    this.turnTimer = setTimeout(() => {
      logger.warn({ matchId: this.matchId }, "Turn timer expired");
      this.callbacks.onTurnTimeout(this.matchId);
    }, this.turnTimeoutMs);

    return deadline;
  }

  /**
   * Clear the current turn timer without triggering the timeout callback.
   */
  clearTurn(): void {
    if (this.turnTimer !== null) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /**
   * Stop all timers (both match and turn).
   * Should be called when the match ends for any reason.
   */
  stop(): void {
    if (this.matchTimer !== null) {
      clearTimeout(this.matchTimer);
      this.matchTimer = null;
    }
    this.clearTurn();

    logger.info({ matchId: this.matchId }, "Match clock stopped");
  }

  /**
   * Returns the remaining time (in milliseconds) for the overall match.
   * Returns 0 if the match timer has not been started or has already expired.
   */
  getTimeRemainingMs(): number {
    if (this.matchStartedAt === 0) {
      return 0;
    }
    const elapsed = Date.now() - this.matchStartedAt;
    const remaining = this.matchDurationMs - elapsed;
    return Math.max(0, remaining);
  }
}
