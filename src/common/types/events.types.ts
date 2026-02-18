import { Board } from './game.types';

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
  side: 'a' | 'b';
  move: { row: number; col: number };
  boardState: Board;
  score: { a: number; b: number };
  moveNumber: number;
  thinkingTimeMs: number;
}

export interface MatchTimeoutEvent {
  matchId: string;
  side: 'a' | 'b';
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

export interface EventBusEvents {
  'match:created': MatchCreatedEvent;
  'match:started': MatchStartedEvent;
  'match:move': MatchMoveEvent;
  'match:timeout': MatchTimeoutEvent;
  'match:ended': MatchEndedEvent;
  'match:error': MatchErrorEvent;
}

export type EventName = keyof EventBusEvents;
