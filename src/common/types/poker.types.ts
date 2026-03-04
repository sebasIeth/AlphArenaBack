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
  playerIndex: number;
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

// ─── Side Pots ────────────────────────────────────────
export interface PokerSidePot {
  amount: number;
  eligibleIndices: number[];  // seat indices eligible to win this pot
}

// ─── Player State ──────────────────────────────────────
export interface PokerPlayerState {
  seatIndex: number;
  playerId: string;     // agentId
  stack: number;
  holeCards: Card[];
  currentBet: number;
  totalBetThisHand: number;
  hasFolded: boolean;
  isAllIn: boolean;
  isDealer: boolean;
  isEliminated: boolean;  // out of chips, no longer in the game
}

// ─── Game State ────────────────────────────────────────
export interface PokerGameState {
  handNumber: number;
  street: PokerStreet;
  pot: number;
  sidePots: PokerSidePot[];
  communityCards: Card[];
  deck: Card[];

  players: PokerPlayerState[];

  smallBlind: number;
  bigBlind: number;
  dealerIndex: number;

  currentPlayerIndex: number;
  lastAggressor: number | null;
  actionsThisStreet: PokerAction[];
  actionHistory: PokerAction[];

  startingStack: number;
  gameOver: boolean;
  winnerIndices: number[] | null;   // indices of final winner(s) — last player(s) standing
  winReason: 'fold' | 'showdown' | 'all_in_runout' | null;
  showdownResult?: PokerShowdownResult[];
}

export interface PokerShowdownResult {
  seatIndex: number;
  hand: HandRank;
  won: number;          // chips won from pot(s)
}

// ─── Move Request (sent to agents) ────────────────────
export interface PokerMoveRequest {
  matchId: string;
  gameType: 'poker';
  handNumber: number;
  street: PokerStreet;
  yourSeatIndex: number;
  yourHoleCards: Card[];
  communityCards: Card[];
  pot: number;
  yourStack: number;
  yourCurrentBet: number;
  players: PokerMoveRequestPlayer[];
  legalActions: PokerLegalActions;
  actionHistory: PokerAction[];
  blinds: { small: number; big: number };
  isDealer: boolean;
  dealerIndex: number;
  timeRemainingMs: number;
}

export interface PokerMoveRequestPlayer {
  seatIndex: number;
  stack: number;
  currentBet: number;
  hasFolded: boolean;
  isAllIn: boolean;
  isDealer: boolean;
  isEliminated: boolean;
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
