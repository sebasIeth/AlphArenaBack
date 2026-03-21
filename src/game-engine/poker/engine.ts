import { PokerGameState, PokerPlayerState, PokerAction, PokerLegalActions, Card } from '../../common/types';
import { createDeck, shuffleDeck, dealCards } from './deck';
import { evaluateHand, compareHands } from './hand-evaluator';
import { getLegalActions as getBettingActions, applyAction as applyBettingAction, isStreetOver } from './betting';

// ─── Seat Utilities ──────────────────────────────────────

/** Get side letters for N players: ['a','b','c',...] */
function sideLetters(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String.fromCharCode(97 + i));
}

/** Next active (non-folded, non-eliminated) seat after fromSide. If skipAllIn, also skip all-in players. */
export function nextActiveSeat(state: PokerGameState, fromSide: string, skipAllIn = false): string {
  const { seatOrder, players } = state;
  const idx = seatOrder.indexOf(fromSide);
  for (let i = 1; i <= seatOrder.length; i++) {
    const side = seatOrder[(idx + i) % seatOrder.length];
    const p = players[side];
    if (!p || p.isEliminated || p.hasFolded) continue;
    if (skipAllIn && p.isAllIn) continue;
    return side;
  }
  return fromSide; // fallback
}

/** Sides that haven't folded and aren't eliminated */
export function getActiveSides(state: PokerGameState): string[] {
  return state.seatOrder.filter(s => {
    const p = state.players[s];
    return p && !p.hasFolded && !p.isEliminated;
  });
}

/** Sides that can still act (not folded, not all-in, not eliminated) */
export function getActableSides(state: PokerGameState): string[] {
  return state.seatOrder.filter(s => {
    const p = state.players[s];
    return p && !p.hasFolded && !p.isAllIn && !p.isEliminated;
  });
}

/** Count non-folded, non-eliminated players */
export function countPlayersInHand(state: PokerGameState): number {
  return getActiveSides(state).length;
}

/** Get non-eliminated players (for next hand) */
function getNonEliminatedSides(state: PokerGameState): string[] {
  return state.seatOrder.filter(s => {
    const p = state.players[s];
    return p && !p.isEliminated && p.stack > 0;
  });
}

/** Get max current bet among all players */
export function getMaxBet(state: PokerGameState): number {
  let max = 0;
  for (const side of state.seatOrder) {
    const p = state.players[side];
    if (p && p.currentBet > max) max = p.currentBet;
  }
  return max;
}

// ─── Core Engine ─────────────────────────────────────────

export function createInitialState(
  startingStack: number,
  smallBlind: number,
  bigBlind: number,
  playerCount: number = 2,
): PokerGameState {
  const seats = sideLetters(Math.min(Math.max(playerCount, 2), 9));
  const players: Record<string, PokerPlayerState> = {};
  for (const side of seats) {
    players[side] = createPlayer(side, startingStack, side === seats[0]);
  }
  return {
    handNumber: 0,
    street: 'preflop',
    pot: 0,
    communityCards: [],
    deck: [],
    players,
    seatOrder: seats,
    smallBlind,
    bigBlind,
    dealerSide: seats[0],
    sbSide: seats[0],
    bbSide: seats.length > 1 ? seats[1] : seats[0],
    currentPlayerSide: seats[0],
    lastAggressor: null,
    actionsThisStreet: [],
    actionHistory: [],
    startingStack,
    gameOver: false,
    winner: null,
    winReason: null,
  };
}

function createPlayer(side: string, stack: number, isDealer: boolean): PokerPlayerState {
  return {
    side,
    stack,
    holeCards: [] as Card[],
    currentBet: 0,
    totalBetThisHand: 0,
    hasFolded: false,
    isAllIn: false,
    isDealer,
    isEliminated: false,
  };
}

export function dealNewHand(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  // Get players still in the game
  const alive = getNonEliminatedSides(s);
  if (alive.length < 2) {
    s.gameOver = true;
    s.winner = alive[0] || null;
    return s;
  }

  // Rotate dealer
  if (s.handNumber > 0) {
    const currentIdx = alive.indexOf(s.dealerSide);
    s.dealerSide = alive[(currentIdx + 1) % alive.length];
  }
  s.handNumber++;

  // Determine blind positions
  const isHeadsUp = alive.length === 2;
  if (isHeadsUp) {
    // Heads-up: dealer = SB, other = BB
    s.sbSide = s.dealerSide;
    s.bbSide = alive.find(x => x !== s.dealerSide)!;
  } else {
    // Multi-way: SB is left of dealer, BB is left of SB
    const dealerIdx = alive.indexOf(s.dealerSide);
    s.sbSide = alive[(dealerIdx + 1) % alive.length];
    s.bbSide = alive[(dealerIdx + 2) % alive.length];
  }

  // Reset all players
  for (const side of s.seatOrder) {
    const p = s.players[side];
    p.holeCards = [];
    p.currentBet = 0;
    p.totalBetThisHand = 0;
    p.hasFolded = false;
    p.isAllIn = false;
    p.isDealer = side === s.dealerSide;
    if (p.stack <= 0) p.isEliminated = true;
  }

  // Reset hand state
  s.street = 'preflop';
  s.pot = 0;
  s.communityCards = [];
  s.lastAggressor = null;
  s.actionsThisStreet = [];
  s.actionHistory = [];
  s.winReason = null;
  s.showdownResult = undefined;

  // Shuffle and deal hole cards to all active players
  let deck = shuffleDeck(createDeck());
  for (const side of alive) {
    const { dealt, remaining } = dealCards(deck, 2);
    s.players[side].holeCards = dealt;
    deck = remaining;
  }
  s.deck = deck;

  // Post blinds
  const sbAmount = Math.min(s.smallBlind, s.players[s.sbSide].stack);
  s.players[s.sbSide].stack -= sbAmount;
  s.players[s.sbSide].currentBet = sbAmount;
  s.players[s.sbSide].totalBetThisHand = sbAmount;
  s.pot += sbAmount;
  if (s.players[s.sbSide].stack === 0) s.players[s.sbSide].isAllIn = true;

  const bbAmount = Math.min(s.bigBlind, s.players[s.bbSide].stack);
  s.players[s.bbSide].stack -= bbAmount;
  s.players[s.bbSide].currentBet = bbAmount;
  s.players[s.bbSide].totalBetThisHand = bbAmount;
  s.pot += bbAmount;
  if (s.players[s.bbSide].stack === 0) s.players[s.bbSide].isAllIn = true;

  // First to act preflop
  if (isHeadsUp) {
    // Heads-up: SB (dealer) acts first preflop
    s.currentPlayerSide = s.sbSide;
  } else {
    // Multi-way: left of BB acts first preflop
    const bbIdx = alive.indexOf(s.bbSide);
    s.currentPlayerSide = alive[(bbIdx + 1) % alive.length];
  }

  return s;
}

export function advanceStreet(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  const nextStreets: Record<string, 'flop' | 'turn' | 'river' | 'showdown'> = {
    preflop: 'flop',
    flop: 'turn',
    turn: 'river',
    river: 'showdown',
  };

  const nextStreet = nextStreets[s.street];
  if (!nextStreet || nextStreet === 'showdown') {
    s.street = 'showdown';
    return s;
  }

  s.street = nextStreet;

  // Deal community cards
  if (nextStreet === 'flop') {
    const { dealt, remaining } = dealCards(s.deck, 3);
    s.communityCards = dealt;
    s.deck = remaining;
  } else if (nextStreet === 'turn' || nextStreet === 'river') {
    const { dealt, remaining } = dealCards(s.deck, 1);
    s.communityCards.push(...dealt);
    s.deck = remaining;
  }

  // Reset bets for new street
  for (const side of s.seatOrder) {
    s.players[side].currentBet = 0;
  }
  s.actionsThisStreet = [];
  s.lastAggressor = null;

  // Post-flop: first active player left of dealer
  const alive = getActiveSides(s);
  const dealerIdx = alive.indexOf(s.dealerSide);
  // Find first active non-all-in player left of dealer
  for (let i = 1; i <= alive.length; i++) {
    const side = alive[(dealerIdx + i) % alive.length];
    if (!s.players[side].isAllIn) {
      s.currentPlayerSide = side;
      break;
    }
  }

  return s;
}

export function resolveShowdown(state: PokerGameState): PokerGameState {
  const s = deepClone(state);
  s.street = 'showdown';

  // Deal remaining community cards if needed
  while (s.communityCards.length < 5) {
    const { dealt, remaining } = dealCards(s.deck, 1);
    s.communityCards.push(...dealt);
    s.deck = remaining;
  }

  // Evaluate all non-folded hands
  const active = getActiveSides(s);
  const hands: Record<string, ReturnType<typeof evaluateHand>> = {};
  for (const side of active) {
    hands[side] = evaluateHand([...s.players[side].holeCards, ...s.communityCards]);
  }

  // Find best hand
  let bestSides: string[] = [active[0]];
  for (let i = 1; i < active.length; i++) {
    const cmp = compareHands(hands[active[i]], hands[bestSides[0]]);
    if (cmp > 0) {
      bestSides = [active[i]];
    } else if (cmp === 0) {
      bestSides.push(active[i]);
    }
  }

  // Distribute pot
  if (bestSides.length === 1) {
    s.players[bestSides[0]].stack += s.pot;
    s.showdownResult = {
      winnerSide: bestSides[0],
      winnerHand: hands[bestSides[0]],
      hands,
    };
  } else {
    // Split pot among tied winners
    const share = Math.floor(s.pot / bestSides.length);
    const remainder = s.pot - share * bestSides.length;
    for (let i = 0; i < bestSides.length; i++) {
      s.players[bestSides[i]].stack += share + (i === 0 ? remainder : 0);
    }
    s.showdownResult = {
      winnerSide: 'draw',
      winnerHand: hands[bestSides[0]],
      hands,
    };
  }

  s.pot = 0;
  const anyAllIn = Object.values(s.players).some(p => p.isAllIn);
  s.winReason = anyAllIn ? 'all_in_runout' : 'showdown';

  // Check match over
  checkMatchOver(s);

  return s;
}

export function resolveFold(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  const active = getActiveSides(s);
  if (active.length !== 1) return s; // shouldn't happen

  const winnerSide = active[0];
  s.players[winnerSide].stack += s.pot;
  s.pot = 0;
  s.winReason = 'fold';

  checkMatchOver(s);

  return s;
}

function checkMatchOver(s: PokerGameState): void {
  const alive = s.seatOrder.filter(side => s.players[side].stack > 0 && !s.players[side].isEliminated);
  if (alive.length <= 1) {
    s.gameOver = true;
    s.winner = alive[0] || null;
  }
}

export function isHandOver(state: PokerGameState): boolean {
  return countPlayersInHand(state) <= 1 || state.street === 'showdown';
}

export function isMatchOver(state: PokerGameState): boolean {
  if (state.gameOver) return true;
  const alive = state.seatOrder.filter(s => state.players[s].stack > 0);
  return alive.length <= 1;
}

export function getLegalActions(state: PokerGameState): PokerLegalActions {
  return getBettingActions(state);
}

export function applyAction(state: PokerGameState, action: PokerAction): PokerGameState {
  return applyBettingAction(state, action);
}

export { isStreetOver } from './betting';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
