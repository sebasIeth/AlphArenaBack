import { PokerGameState, PokerAction, PokerLegalActions, PokerPlayerState, PokerShowdownResult, Card } from '../../common/types';
import { createDeck, shuffleDeck, dealCards } from './deck';
import { evaluateHand, compareHands } from './hand-evaluator';
import { getLegalActions as getBettingActions, applyAction as applyBettingAction, isStreetOver, nextActivePlayer, calculateSidePots } from './betting';

export function createInitialState(
  playerCount: number,
  startingStack: number,
  smallBlind: number,
  bigBlind: number,
): PokerGameState {
  const players: PokerPlayerState[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({
      seatIndex: i,
      playerId: '',  // set by caller
      stack: startingStack,
      holeCards: [],
      currentBet: 0,
      totalBetThisHand: 0,
      hasFolded: false,
      isAllIn: false,
      isDealer: i === 0,
      isEliminated: false,
    });
  }

  return {
    handNumber: 0,
    street: 'preflop',
    pot: 0,
    sidePots: [],
    communityCards: [],
    deck: [],
    players,
    smallBlind,
    bigBlind,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    lastAggressor: null,
    actionsThisStreet: [],
    actionHistory: [],
    startingStack,
    gameOver: false,
    winnerIndices: null,
    winReason: null,
  };
}

/**
 * Find the next non-eliminated player index starting from (fromIndex + 1).
 */
function nextLivePlayer(players: PokerPlayerState[], fromIndex: number): number {
  const n = players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    if (!players[idx].isEliminated) return idx;
  }
  return fromIndex;
}

export function dealNewHand(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  // Rotate dealer to the next live player
  if (s.handNumber > 0) {
    s.dealerIndex = nextLivePlayer(s.players, s.dealerIndex);
  }
  s.handNumber++;

  // Reset players for new hand
  for (const p of s.players) {
    p.holeCards = [];
    p.currentBet = 0;
    p.totalBetThisHand = 0;
    p.hasFolded = false;
    p.isAllIn = false;
    p.isDealer = p.seatIndex === s.dealerIndex;
    // Eliminate players with no chips
    if (p.stack <= 0 && !p.isEliminated) {
      p.isEliminated = true;
    }
  }

  // Reset hand state
  s.street = 'preflop';
  s.pot = 0;
  s.sidePots = [];
  s.communityCards = [];
  s.lastAggressor = null;
  s.actionsThisStreet = [];
  s.actionHistory = [];
  s.winReason = null;
  s.showdownResult = undefined;

  // Count live (non-eliminated) players
  const livePlayers = s.players.filter(p => !p.isEliminated);
  if (livePlayers.length < 2) {
    s.gameOver = true;
    s.winnerIndices = livePlayers.map(p => p.seatIndex);
    return s;
  }

  // Shuffle and deal hole cards to live players
  const deck = shuffleDeck(createDeck());
  let remaining = deck;
  for (const p of s.players) {
    if (p.isEliminated) continue;
    const result = dealCards(remaining, 2);
    p.holeCards = result.dealt;
    remaining = result.remaining;
  }
  s.deck = remaining;

  // Post blinds
  const isHeadsUp = livePlayers.length === 2;

  let sbIndex: number;
  let bbIndex: number;

  if (isHeadsUp) {
    // Heads-up: dealer posts SB, other posts BB
    sbIndex = s.dealerIndex;
    bbIndex = nextLivePlayer(s.players, s.dealerIndex);
  } else {
    // Normal: SB is left of dealer, BB is left of SB
    sbIndex = nextLivePlayer(s.players, s.dealerIndex);
    bbIndex = nextLivePlayer(s.players, sbIndex);
  }

  // Post small blind
  const sbPlayer = s.players[sbIndex];
  const sbAmount = Math.min(s.smallBlind, sbPlayer.stack);
  sbPlayer.stack -= sbAmount;
  sbPlayer.currentBet = sbAmount;
  sbPlayer.totalBetThisHand = sbAmount;
  s.pot += sbAmount;
  if (sbPlayer.stack === 0) sbPlayer.isAllIn = true;

  // Post big blind
  const bbPlayer = s.players[bbIndex];
  const bbAmount = Math.min(s.bigBlind, bbPlayer.stack);
  bbPlayer.stack -= bbAmount;
  bbPlayer.currentBet = bbAmount;
  bbPlayer.totalBetThisHand = bbAmount;
  s.pot += bbAmount;
  if (bbPlayer.stack === 0) bbPlayer.isAllIn = true;

  // First to act preflop: left of BB (or dealer in heads-up)
  if (isHeadsUp) {
    s.currentPlayerIndex = sbIndex; // dealer/SB acts first in heads-up preflop
  } else {
    s.currentPlayerIndex = nextLivePlayer(s.players, bbIndex);
    // Skip eliminated and all-in players
    while (s.players[s.currentPlayerIndex].isAllIn || s.players[s.currentPlayerIndex].isEliminated) {
      const next = nextActivePlayer(s, s.currentPlayerIndex);
      if (next === -1) break;
      s.currentPlayerIndex = next;
      break;
    }
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
  for (const p of s.players) {
    p.currentBet = 0;
  }
  s.actionsThisStreet = [];
  s.lastAggressor = null;

  // Post-flop: first active player left of dealer
  const firstActive = nextActivePlayer(s, s.dealerIndex);
  if (firstActive !== -1) {
    s.currentPlayerIndex = firstActive;
  }

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

  // Calculate side pots
  const sidePots = calculateSidePots(s.players);
  s.sidePots = sidePots;

  // Evaluate hands for all non-folded, non-eliminated players
  const contenders = s.players.filter(p => !p.hasFolded && !p.isEliminated);
  const handEvals = new Map<number, ReturnType<typeof evaluateHand>>();
  for (const p of contenders) {
    handEvals.set(p.seatIndex, evaluateHand([...p.holeCards, ...s.communityCards]));
  }

  const results: PokerShowdownResult[] = [];
  let totalDistributed = 0;

  // Distribute each pot to the best hand(s) among eligible players
  for (const pot of sidePots) {
    const eligible = pot.eligibleIndices.filter(idx => handEvals.has(idx));
    if (eligible.length === 0) continue;

    // Find best hand among eligible
    let bestIndices: number[] = [eligible[0]];
    let bestHand = handEvals.get(eligible[0])!;

    for (let i = 1; i < eligible.length; i++) {
      const idx = eligible[i];
      const hand = handEvals.get(idx)!;
      const cmp = compareHands(hand, bestHand);
      if (cmp > 0) {
        bestIndices = [idx];
        bestHand = hand;
      } else if (cmp === 0) {
        bestIndices.push(idx);
      }
    }

    // Split this pot among winners
    const share = Math.floor(pot.amount / bestIndices.length);
    const remainder = pot.amount - share * bestIndices.length;

    for (let i = 0; i < bestIndices.length; i++) {
      const winIdx = bestIndices[i];
      const won = share + (i === 0 ? remainder : 0); // first winner gets remainder
      s.players[winIdx].stack += won;
      totalDistributed += won;

      const existing = results.find(r => r.seatIndex === winIdx);
      if (existing) {
        existing.won += won;
      } else {
        results.push({ seatIndex: winIdx, hand: handEvals.get(winIdx)!, won });
      }
    }
  }

  // Add results for losing contenders
  for (const p of contenders) {
    if (!results.find(r => r.seatIndex === p.seatIndex)) {
      results.push({ seatIndex: p.seatIndex, hand: handEvals.get(p.seatIndex)!, won: 0 });
    }
  }

  s.showdownResult = results;
  s.pot = 0;

  const anyAllIn = s.players.some(p => p.isAllIn && !p.hasFolded && !p.isEliminated);
  s.winReason = anyAllIn ? 'all_in_runout' : 'showdown';

  // Check for eliminated players and game over
  checkGameOver(s);

  return s;
}

export function resolveFold(state: PokerGameState): PokerGameState {
  const s = deepClone(state);

  const nonFolded = s.players.filter(p => !p.hasFolded && !p.isEliminated);
  if (nonFolded.length !== 1) {
    throw new Error(`resolveFold called but ${nonFolded.length} players remain`);
  }

  const winner = nonFolded[0];
  winner.stack += s.pot;
  s.pot = 0;
  s.winReason = 'fold';

  checkGameOver(s);

  return s;
}

function checkGameOver(s: PokerGameState): void {
  const playersWithChips = s.players.filter(p => !p.isEliminated && p.stack > 0);
  if (playersWithChips.length <= 1) {
    s.gameOver = true;
    s.winnerIndices = playersWithChips.map(p => p.seatIndex);
    // Mark losers as eliminated
    for (const p of s.players) {
      if (p.stack <= 0 && !p.isEliminated) {
        p.isEliminated = true;
      }
    }
  }
}

export function isHandOver(state: PokerGameState): boolean {
  const nonFolded = state.players.filter(p => !p.hasFolded && !p.isEliminated);
  return nonFolded.length <= 1 || state.street === 'showdown';
}

export function isMatchOver(state: PokerGameState): boolean {
  if (state.gameOver) return true;
  const playersWithChips = state.players.filter(p => !p.isEliminated && p.stack > 0);
  return playersWithChips.length <= 1;
}

export function getLegalActions(state: PokerGameState): PokerLegalActions {
  return getBettingActions(state);
}

export function applyAction(state: PokerGameState, action: PokerAction): PokerGameState {
  return applyBettingAction(state, action);
}

/**
 * Check if all non-folded players are all-in (no active players to act).
 */
export function allPlayersAllIn(state: PokerGameState): boolean {
  const nonFolded = state.players.filter(p => !p.hasFolded && !p.isEliminated);
  return nonFolded.every(p => p.isAllIn);
}

export { isStreetOver } from './betting';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
