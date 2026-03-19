export const MATCH_DURATION_MS = 1_200_000;
export const TURN_TIMEOUT_MS = 20_000;
export const PULL_AGENT_TURN_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUTS = 2;
const isProd = process.env.NODE_ENV === 'production';
export const MIN_STAKE = 1_000_000;
export const MAX_STAKE = 1_000_000;
export const PLATFORM_FEE_PERCENT = 5;
export const MATCHMAKING_INTERVAL_MS = 2_000;
export const MATCHMAKING_COUNTDOWN_MS = 30_000;
export const ELO_MATCH_RANGE = 200;
export const DEFAULT_ELO = 1200;
export const TOKEN_DECIMALS = 18;
export const BOARD_SIZE = 8;

export const PIECE = {
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,
} as const;

export const GAME_TYPES = ['marrakech', 'chess', 'poker'] as const;

export const POKER_SMALL_BLIND = 20;
export const POKER_BIG_BLIND = 40;
export const POKER_MAX_HANDS = 3;

export const CHESS_PIECE = {
  EMPTY: 0,
  W_PAWN: 1, W_KNIGHT: 2, W_BISHOP: 3, W_ROOK: 4, W_QUEEN: 5, W_KING: 6,
  B_PAWN: 7, B_KNIGHT: 8, B_BISHOP: 9, B_ROOK: 10, B_QUEEN: 11, B_KING: 12,
} as const;
export type GameType = (typeof GAME_TYPES)[number];
