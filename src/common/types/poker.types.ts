// ─── Card Representation ──────────────────────────────
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

// ─── Hand Ranking ──────────────────────────────────────
export type HandRankName =
  | 'royal_flush' | 'straight_flush' | 'four_of_a_kind'
  | 'full_house' | 'flush' | 'straight' | 'three_of_a_kind'
  | 'two_pair' | 'one_pair' | 'high_card';

export interface HandRank {
  name: HandRankName;
  rank: number;         // 10=royal flush, 1=high card
  tiebreaker: number[]; // kickers for comparison
  description: string;  // e.g. "Pair of Kings"
}

// ─── Betting ───────────────────────────────────────────
export type PokerActionType = 'fold' | 'check' | 'call' | 'raise' | 'all_in';
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface PokerAction {
  type: PokerActionType;
  amount?: number;
  playerSide: 'a' | 'b';
  street: PokerStreet;
  timestamp: number;
}

export interface PokerLegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaise: number;
  maxRaise: number;
  canAllIn: boolean;
  allInAmount: number;
}

// ─── Player State ──────────────────────────────────────
export interface PokerPlayerState {
  side: 'a' | 'b';
  stack: number;
  holeCards: Card[];
  currentBet: number;
  totalBetThisHand: number;
  hasFolded: boolean;
  isAllIn: boolean;
  isDealer: boolean;
}

// ─── Game State ────────────────────────────────────────
export interface PokerGameState {
  handNumber: number;
  street: PokerStreet;
  pot: number;
  communityCards: Card[];
  deck: Card[];

  players: {
    a: PokerPlayerState;
    b: PokerPlayerState;
  };

  smallBlind: number;
  bigBlind: number;
  dealerSide: 'a' | 'b';

  currentPlayerSide: 'a' | 'b';
  lastAggressor: 'a' | 'b' | null;
  actionsThisStreet: PokerAction[];
  actionHistory: PokerAction[];

  startingStack: number;
  gameOver: boolean;
  winner: 'a' | 'b' | 'draw' | null;
  winReason: 'fold' | 'showdown' | 'all_in_runout' | null;
  showdownResult?: {
    winnerSide: 'a' | 'b' | 'draw';
    winnerHand: HandRank;
    loserHand: HandRank;
  };
}

// ─── Move Request (sent to agents) ────────────────────
export interface PokerMoveRequest {
  matchId: string;
  gameType: 'poker';
  handNumber: number;
  street: PokerStreet;
  yourSide: 'a' | 'b';
  yourHoleCards: Card[];
  communityCards: Card[];
  pot: number;
  yourStack: number;
  opponentStack: number;
  yourCurrentBet: number;
  opponentCurrentBet: number;
  legalActions: PokerLegalActions;
  actionHistory: PokerAction[];
  blinds: { small: number; big: number };
  isDealer: boolean;
  timeRemainingMs: number;
}

// ─── Move Response (from agents) ──────────────────────
export interface PokerMoveResponse {
  action: PokerActionType;
  amount?: number;
}

// ─── Turn Result ──────────────────────────────────────
export interface PokerHandResult {
  pokerState: PokerGameState;
  handOver: boolean;
  matchOver: boolean;
}
