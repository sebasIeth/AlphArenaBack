import { PokerGameState, PokerAction, PokerLegalActions, Card } from '../../common/types';
import { createDeck, shuffleDeck, dealCards } from './deck';
import { evaluateHand, compareHands } from './hand-evaluator';
import { getLegalActions as getBettingActions, applyAction as applyBettingAction, isStreetOver } from './betting';

export function createInitialState(
  startingStack: number,
  smallBlind: number,
  bigBlind: number,
  dealerSide: 'a' | 'b' = 'a',
): PokerGameState {
  return {
    handNumber: 0,
    street: 'preflop',
    pot: 0,
    communityCards: [],
    deck: [],
    players: {
      a: createPlayer('a', startingStack, dealerSide === 'a'),
      b: createPlayer('b', startingStack, dealerSide === 'b'),
    },
    smallBlind,
    bigBlind,
    dealerSide,
    currentPlayerSide: dealerSide, // dealer (SB) acts first preflop in heads-up
    lastAggressor: null,
    actionsThisStreet: [],
    actionHistory: [],
    startingStack,
    gameOver: false,
    winner: null,
    winReason: null,
  };
}

function createPlayer(side: 'a' | 'b', stack: number, isDealer: boolean) {
  return {
    side,
    stack,
    holeCards: [] as Card[],
    currentBet: 0,
    totalBetThisHand: 0,
    hasFolded: false,
    isAllIn: false,
    isDealer,
  };
}

function opp(side: 'a' | 'b'): 'a' | 'b' {
  return side === 'a' ? 'b' : 'a';
}

export function dealNewHand(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  // Alternate dealer
  if (s.handNumber > 0) {
    s.dealerSide = opp(s.dealerSide);
  }
  s.handNumber++;

  // Reset players
  for (const side of ['a', 'b'] as const) {
    s.players[side].holeCards = [];
    s.players[side].currentBet = 0;
    s.players[side].totalBetThisHand = 0;
    s.players[side].hasFolded = false;
    s.players[side].isAllIn = false;
    s.players[side].isDealer = side === s.dealerSide;
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

  // Shuffle and deal
  const deck = shuffleDeck(createDeck());
  const holeA = dealCards(deck, 2);
  const holeB = dealCards(holeA.remaining, 2);
  s.players.a.holeCards = holeA.dealt;
  s.players.b.holeCards = holeB.dealt;
  s.deck = holeB.remaining;

  // Post blinds — dealer = SB, non-dealer = BB
  const sbSide = s.dealerSide;
  const bbSide = opp(s.dealerSide);

  const sbAmount = Math.min(s.smallBlind, s.players[sbSide].stack);
  s.players[sbSide].stack -= sbAmount;
  s.players[sbSide].currentBet = sbAmount;
  s.players[sbSide].totalBetThisHand = sbAmount;
  s.pot += sbAmount;
  if (s.players[sbSide].stack === 0) s.players[sbSide].isAllIn = true;

  const bbAmount = Math.min(s.bigBlind, s.players[bbSide].stack);
  s.players[bbSide].stack -= bbAmount;
  s.players[bbSide].currentBet = bbAmount;
  s.players[bbSide].totalBetThisHand = bbAmount;
  s.pot += bbAmount;
  if (s.players[bbSide].stack === 0) s.players[bbSide].isAllIn = true;

  // Preflop: dealer (SB) acts first in heads-up
  s.currentPlayerSide = sbSide;

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
  s.players.a.currentBet = 0;
  s.players.b.currentBet = 0;
  s.actionsThisStreet = [];
  s.lastAggressor = null;

  // Post-flop: non-dealer (BB) acts first
  s.currentPlayerSide = opp(s.dealerSide);

  return s;
}

export function resolveShowdown(state: PokerGameState): PokerGameState {
  const s = deepClone(state);
  s.street = 'showdown';

  // Deal remaining community cards if needed (all-in runout)
  while (s.communityCards.length < 5) {
    const { dealt, remaining } = dealCards(s.deck, 1);
    s.communityCards.push(...dealt);
    s.deck = remaining;
  }

  const handA = evaluateHand([...s.players.a.holeCards, ...s.communityCards]);
  const handB = evaluateHand([...s.players.b.holeCards, ...s.communityCards]);
  const comparison = compareHands(handA, handB);

  if (comparison > 0) {
    s.players.a.stack += s.pot;
    s.showdownResult = { winnerSide: 'a', winnerHand: handA, loserHand: handB };
  } else if (comparison < 0) {
    s.players.b.stack += s.pot;
    s.showdownResult = { winnerSide: 'b', winnerHand: handB, loserHand: handA };
  } else {
    // Split pot
    const half = Math.floor(s.pot / 2);
    s.players.a.stack += half;
    s.players.b.stack += s.pot - half;
    s.showdownResult = { winnerSide: 'draw', winnerHand: handA, loserHand: handB };
  }

  s.pot = 0;
  s.winReason = s.players.a.isAllIn || s.players.b.isAllIn ? 'all_in_runout' : 'showdown';

  // Check match over
  if (s.players.a.stack <= 0) {
    s.gameOver = true;
    s.winner = 'b';
  } else if (s.players.b.stack <= 0) {
    s.gameOver = true;
    s.winner = 'a';
  }

  return s;
}

export function resolveFold(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  const folderSide = s.players.a.hasFolded ? 'a' : 'b';
  const winnerSide = opp(folderSide);

  s.players[winnerSide].stack += s.pot;
  s.pot = 0;
  s.winReason = 'fold';

  if (s.players.a.stack <= 0) {
    s.gameOver = true;
    s.winner = 'b';
  } else if (s.players.b.stack <= 0) {
    s.gameOver = true;
    s.winner = 'a';
  }

  return s;
}

export function isHandOver(state: PokerGameState): boolean {
  return state.players.a.hasFolded || state.players.b.hasFolded || state.street === 'showdown';
}

export function isMatchOver(state: PokerGameState): boolean {
  return state.gameOver || state.players.a.stack <= 0 || state.players.b.stack <= 0;
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
