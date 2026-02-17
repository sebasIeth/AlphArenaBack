import type { Board, PlayerColor, Position } from "./game.js";

export interface MatchCreatedEvent {
  matchId: string;
  agents: { a: { agentId: string; name: string }; b: { agentId: string; name: string } };
  gameType: string;
  stakeAmount: number;
}

export interface MatchStartedEvent {
  matchId: string;
  gameType: string;
  board: Board;
}

export interface MatchMoveEvent {
  matchId: string;
  side: "a" | "b";
  move: { row: number; col: number };
  boardState: Board;
  score: { a: number; b: number };
  moveNumber: number;
  thinkingTimeMs: number;
}

export interface MatchTimeoutEvent {
  matchId: string;
  side: "a" | "b";
  timeoutCount: number;
}

export interface MatchEndedEvent {
  matchId: string;
  result: {
    winnerId: string | null;
    reason: string;
    finalScore: { a: number; b: number };
    totalMoves: number;
  };
}

export interface MatchErrorEvent {
  matchId: string;
  error: string;
}

export interface QueueJoinedEvent {
  agentId: string;
  gameType: string;
}

export interface QueuePairedEvent {
  agentA: string;
  agentB: string;
  matchId: string;
}

export interface EventBusEvents {
  "match:created": MatchCreatedEvent;
  "match:started": MatchStartedEvent;
  "match:move": MatchMoveEvent;
  "match:timeout": MatchTimeoutEvent;
  "match:ended": MatchEndedEvent;
  "match:error": MatchErrorEvent;
  "queue:joined": QueueJoinedEvent;
  "queue:paired": QueuePairedEvent;
}

export type EventName = keyof EventBusEvents;

export interface WsClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  matchId?: string;
}

export interface WsServerMessage {
  type: "match:start" | "match:move" | "match:timeout" | "match:end" | "match:state" | "pong" | "error";
  data: unknown;
}
