import type {
  Match,
  MatchStartedEvent,
  MatchMoveEvent,
  MatchTimeoutEvent,
  MatchEndedEvent,
  Board,
} from "@alpharena/shared";

/**
 * Serialized match state sent to WebSocket clients.
 * Strips internal implementation details and only includes
 * what the frontend needs to render.
 */
export interface SerializedMatchState {
  matchId: string;
  board: Board;
  scores: { a: number; b: number };
  currentTurn: "a" | "b";
  moveCount: number;
  timeouts: { a: number; b: number };
  status: string;
  timeRemainingMs: { a: number; b: number } | null;
}

export interface SerializedMatchStart {
  matchId: string;
  gameType: string;
  board: Board;
}

export interface SerializedMoveEvent {
  matchId: string;
  side: "a" | "b";
  move: { row: number; col: number };
  boardState: Board;
  score: { a: number; b: number };
  moveNumber: number;
  thinkingTimeMs: number;
}

export interface SerializedTimeoutEvent {
  matchId: string;
  side: "a" | "b";
  timeoutCount: number;
}

export interface SerializedMatchEnd {
  matchId: string;
  result: {
    winnerId: string | null;
    reason: string;
    finalScore: { a: number; b: number };
    totalMoves: number;
  };
}

/**
 * Convert internal Match state to a clean object for WebSocket clients.
 * Strips internal fields like txHashes, timestamps, and agent details
 * that the frontend spectator view does not need.
 */
export function serializeMatchState(match: Match): SerializedMatchState {
  let timeRemainingMs: { a: number; b: number } | null = null;

  if (match.status === "active" && match.startedAt) {
    // Calculate approximate time remaining based on match duration.
    // The actual turn timer is managed server-side; this provides
    // a rough estimate for the client UI.
    const elapsed = Date.now() - new Date(match.startedAt).getTime();
    const totalDuration = 1_200_000; // 20 minutes (MATCH_DURATION_MS)
    const remaining = Math.max(0, totalDuration - elapsed);
    timeRemainingMs = { a: remaining, b: remaining };
  }

  return {
    matchId: match.id,
    board: match.currentBoard as Board,
    scores: {
      a: match.result?.finalScore.a ?? 0,
      b: match.result?.finalScore.b ?? 0,
    },
    currentTurn: match.currentTurn,
    moveCount: match.moveCount,
    timeouts: match.timeouts,
    status: match.status,
    timeRemainingMs,
  };
}

/**
 * Serialize a MatchStartedEvent for WebSocket broadcast.
 */
export function serializeMatchStart(event: MatchStartedEvent): SerializedMatchStart {
  return {
    matchId: event.matchId,
    gameType: event.gameType,
    board: event.board,
  };
}

/**
 * Serialize a MatchMoveEvent for WebSocket broadcast.
 * Passes through the essential move data in a clean format.
 */
export function serializeMoveEvent(event: MatchMoveEvent): SerializedMoveEvent {
  return {
    matchId: event.matchId,
    side: event.side,
    move: { row: event.move.row, col: event.move.col },
    boardState: event.boardState,
    score: { a: event.score.a, b: event.score.b },
    moveNumber: event.moveNumber,
    thinkingTimeMs: event.thinkingTimeMs,
  };
}

/**
 * Serialize a MatchTimeoutEvent for WebSocket broadcast.
 */
export function serializeTimeoutEvent(event: MatchTimeoutEvent): SerializedTimeoutEvent {
  return {
    matchId: event.matchId,
    side: event.side,
    timeoutCount: event.timeoutCount,
  };
}

/**
 * Serialize a MatchEndedEvent for WebSocket broadcast.
 */
export function serializeMatchEnd(event: MatchEndedEvent): SerializedMatchEnd {
  return {
    matchId: event.matchId,
    result: {
      winnerId: event.result.winnerId,
      reason: event.result.reason,
      finalScore: { a: event.result.finalScore.a, b: event.result.finalScore.b },
      totalMoves: event.result.totalMoves,
    },
  };
}
