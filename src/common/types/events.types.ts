import { Board } from './game.types';

export interface MatchCreatedEvent {
  matchId: string;
  agents: { a: { agentId: string; name: string }; b: { agentId: string; name: string } };
  pokerPlayers?: { agentId: string; name: string; seatIndex: number }[];
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
  // Chess-specific
  fen?: string;
  // Poker-specific (legacy 2-player)
  pokerPlayerStacks?: { a: number; b: number };
  pokerHandNumber?: number;
  // Poker N-player
  pokerPlayers?: { seatIndex: number; playerId: string; name?: string; stack: number }[];
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
  // Chess-specific
  chessMove?: string;
  fen?: string;
  isCheck?: boolean;
  // Poker-specific (legacy 2-player)
  pokerAction?: { type: string; amount?: number };
  pokerStreet?: string;
  pokerPot?: number;
  pokerCommunityCards?: { rank: string; suit: string }[];
  pokerPlayerStacks?: { a: number; b: number };
  pokerHandNumber?: number;
  // Poker N-player
  pokerPlayers?: { seatIndex: number; name?: string; playerId?: string; isAgent?: boolean; stack: number; currentBet: number; hasFolded: boolean; isAllIn: boolean; isEliminated: boolean }[];
  pokerPlayerIndex?: number;
}

export interface MatchTimeoutEvent {
  matchId: string;
  side: 'a' | 'b';
  timeoutCount: number;
  seatIndex?: number;
}

export interface MatchEndedEvent {
  matchId: string;
  agentIds: { a: string; b: string };
  pokerPlayerIds?: string[];
  gameType: string;
  result: {
    winnerId: string | null;
    reason: string;
    finalScore: { a: number; b: number };
    totalMoves: number;
    pokerFinalScores?: Record<string, number>;
  };
}

export interface MatchErrorEvent {
  matchId: string;
  agentIds?: { a: string; b: string };
  pokerPlayerIds?: string[];
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

export interface MatchYourTurnEvent {
  matchId: string;
  side: 'a' | 'b';
  gameType: string;
  board: Board;
  legalMoves: unknown[];
  fen?: string;
  moveNumber: number;
  timeRemainingMs: number;
  turnTimeoutMs: number;
  // Poker-specific (legacy 2-player)
  pokerHoleCards?: { rank: string; suit: string }[];
  pokerCommunityCards?: { rank: string; suit: string }[];
  pokerPot?: number;
  pokerPlayerStacks?: { a: number; b: number };
  pokerStreet?: string;
  pokerHandNumber?: number;
  pokerIsDealer?: boolean;
  pokerActionHistory?: { type: string; amount?: number; playerSide?: string; playerIndex?: number; street: string }[];
  // Poker N-player
  pokerPlayers?: { seatIndex: number; name?: string; playerId?: string; isAgent?: boolean; stack: number; currentBet: number; hasFolded: boolean; isAllIn: boolean; isDealer: boolean; isEliminated: boolean }[];
  pokerSeatIndex?: number;
  pokerCurrentPlayerIndex?: number;
}

export interface PokerLobbyUpdateEvent {
  gameType: string;
  players: { agentId: string; name: string; eloRating: number }[];
  countdownMs: number | null;
  playerCount: number;
  minPlayers: number;
  maxPlayers: number;
}

export interface MatchmakingQueueJoinedEvent {
  agentId: string;
  gameType: string;
  agentType?: string;
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
  'matchmaking:queue_joined': MatchmakingQueueJoinedEvent;
  'match:your_turn': MatchYourTurnEvent;
  'poker:lobby_update': PokerLobbyUpdateEvent;
}

export type EventName = keyof EventBusEvents;
