export const MATCH_DURATION_MS = 1_200_000;
export const TURN_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUTS = 3;
export const MIN_STAKE = 10;
export const MAX_STAKE = 10_000;
export const PLATFORM_FEE_PERCENT = 5;
export const MATCHMAKING_INTERVAL_MS = 2_000;
export const ELO_MATCH_RANGE = 200;
export const DEFAULT_ELO = 1200;
export const BOARD_SIZE = 8;

export const PIECE = {
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,
} as const;

export const GAME_TYPES = ['reversi', 'marrakech'] as const;
export type GameType = (typeof GAME_TYPES)[number];
