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
  // Marrakech-specific
  assam?: { position: { row: number; col: number }; direction: string };
  players?: { id: number; name: string; dirhams: number; carpetsRemaining: number }[];
}

export interface MatchMoveEvent {
  matchId: string;
  side: 'a' | 'b';
  move: { row: number; col: number };
  boardState: Board;
  score: { a: number; b: number };
  moveNumber: number;
  thinkingTimeMs: number;
  // Marrakech-specific
  assam?: { position: { row: number; col: number }; direction: string };
  diceResult?: { value: number; faces: number[] };
  movePath?: { row: number; col: number }[];
  phase?: string;
  tribute?: { fromPlayerId: number; toPlayerId: number; amount: number } | null;
  players?: { id: number; name: string; dirhams: number; carpetsRemaining: number; eliminated: boolean }[];
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

export interface AgentThinkingEvent {
  matchId: string;
  side: 'a' | 'b';
  agentId: string;
  raw: string;
  moveNumber: number;
}

export interface MatchmakingCountdownEvent {
  gameType: string;
  remainingMs: number;
  agents: { agentId: string; eloRating: number }[];
}

export interface MatchmakingMatchedEvent {
  matchId: string;
  gameType: string;
  agents: string[];
}

export interface EventBusEvents {
  'match:created': MatchCreatedEvent;
  'match:started': MatchStartedEvent;
  'match:move': MatchMoveEvent;
  'match:timeout': MatchTimeoutEvent;
  'match:ended': MatchEndedEvent;
  'match:error': MatchErrorEvent;
  'agent:thinking': AgentThinkingEvent;
  'matchmaking:countdown': MatchmakingCountdownEvent;
  'matchmaking:matched': MatchmakingMatchedEvent;
}

export type EventName = keyof EventBusEvents;
