import type { GameState, PlayerColor } from "@alpharena/shared";
import type { MatchClock } from "./match-clock.js";

/**
 * Represents the in-memory state of an active match being managed
 * by the orchestrator.
 */
export interface ActiveMatchState {
  /** The MongoDB document ID for this match. */
  matchId: string;

  /** The current game state (board, scores, current player, etc.). */
  gameState: GameState;

  /** The match clock managing overall and per-turn timers. */
  clock: MatchClock | null;

  /** Unix timestamp (ms) by which the current turn must complete. */
  turnDeadline: number;

  /** Cumulative timeout counts per side. */
  timeouts: { a: number; b: number };

  /** Current lifecycle status of the match. */
  status: "starting" | "active";

  /** The two agents participating in this match. */
  agents: {
    a: { agentId: string; endpointUrl: string; piece: PlayerColor };
    b: { agentId: string; endpointUrl: string; piece: PlayerColor };
  };

  /** Unix timestamp (ms) when the match was started. */
  startedAt: number;
}

/** In-memory map of all currently active matches, keyed by matchId. */
export const activeMatches = new Map<string, ActiveMatchState>();

/**
 * Retrieve an active match state by its ID.
 * Returns `undefined` if no match with the given ID is active.
 */
export function getMatch(matchId: string): ActiveMatchState | undefined {
  return activeMatches.get(matchId);
}

/**
 * Add a new match to the active matches map.
 * Throws if a match with the same ID already exists.
 */
export function addMatch(state: ActiveMatchState): void {
  if (activeMatches.has(state.matchId)) {
    throw new Error(`Match ${state.matchId} is already in the active matches map.`);
  }
  activeMatches.set(state.matchId, state);
}

/**
 * Remove a match from the active matches map.
 * Returns `true` if the match was found and removed, `false` otherwise.
 */
export function removeMatch(matchId: string): boolean {
  return activeMatches.delete(matchId);
}

/**
 * Update an existing active match state with partial changes.
 * Throws if the match is not found in the active matches map.
 */
export function updateMatch(
  matchId: string,
  updates: Partial<ActiveMatchState>,
): ActiveMatchState {
  const existing = activeMatches.get(matchId);
  if (!existing) {
    throw new Error(`Match ${matchId} not found in active matches.`);
  }
  const updated: ActiveMatchState = { ...existing, ...updates };
  activeMatches.set(matchId, updated);
  return updated;
}
