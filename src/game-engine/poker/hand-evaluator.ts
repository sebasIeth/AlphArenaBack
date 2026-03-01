import { Card, HandRank, HandRankName } from '../../common/types';
import { RANK_VALUES, HAND_RANK_VALUES } from './constants';

function rankVal(card: Card): number {
  return RANK_VALUES[card.rank];
}

function getCombinations(arr: Card[], size: number): Card[][] {
  if (size === arr.length) return [arr];
  if (size === 1) return arr.map(c => [c]);
  const result: Card[][] = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1);
    for (const combo of rest) {
      result.push([arr[i], ...combo]);
    }
  }
  return result;
}

function evaluateFiveCards(cards: Card[]): HandRank {
  const values = cards.map(rankVal).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (including ace-low: A-2-3-4-5)
  let isStraight = false;
  let straightHigh = 0;

  const unique = [...new Set(values)];
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) {
      isStraight = true;
      straightHigh = unique[0];
    }
    // Ace-low straight: A-5-4-3-2
    if (unique[0] === 14 && unique[1] === 5 && unique[2] === 4 && unique[3] === 3 && unique[4] === 2) {
      isStraight = true;
      straightHigh = 5; // 5-high straight
    }
  }

  // Count ranks
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Determine hand
  let name: HandRankName;
  let tiebreaker: number[];

  if (isFlush && isStraight && straightHigh === 14) {
    name = 'royal_flush';
    tiebreaker = [14];
  } else if (isFlush && isStraight) {
    name = 'straight_flush';
    tiebreaker = [straightHigh];
  } else if (groups[0][1] === 4) {
    name = 'four_of_a_kind';
    tiebreaker = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    name = 'full_house';
    tiebreaker = [groups[0][0], groups[1][0]];
  } else if (isFlush) {
    name = 'flush';
    tiebreaker = values;
  } else if (isStraight) {
    name = 'straight';
    tiebreaker = [straightHigh];
  } else if (groups[0][1] === 3) {
    name = 'three_of_a_kind';
    const kickers = groups.filter(g => g[1] === 1).map(g => g[0]).sort((a, b) => b - a);
    tiebreaker = [groups[0][0], ...kickers];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    name = 'two_pair';
    const pairs = groups.filter(g => g[1] === 2).map(g => g[0]).sort((a, b) => b - a);
    const kicker = groups.find(g => g[1] === 1)![0];
    tiebreaker = [...pairs, kicker];
  } else if (groups[0][1] === 2) {
    name = 'one_pair';
    const kickers = groups.filter(g => g[1] === 1).map(g => g[0]).sort((a, b) => b - a);
    tiebreaker = [groups[0][0], ...kickers];
  } else {
    name = 'high_card';
    tiebreaker = values;
  }

  const rankNames: Record<number, string> = {
    14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: '10',
    9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2',
  };

  const descriptions: Record<HandRankName, string> = {
    royal_flush: 'Royal Flush',
    straight_flush: `Straight Flush, ${rankNames[straightHigh]}-high`,
    four_of_a_kind: `Four ${rankNames[groups[0][0]]}s`,
    full_house: `Full House, ${rankNames[groups[0][0]]}s over ${rankNames[groups[1][0]]}s`,
    flush: `Flush, ${rankNames[values[0]]}-high`,
    straight: `Straight, ${rankNames[straightHigh]}-high`,
    three_of_a_kind: `Three ${rankNames[groups[0][0]]}s`,
    two_pair: `Two Pair, ${rankNames[groups[0][0]]}s and ${rankNames[groups[1][0]]}s`,
    one_pair: `Pair of ${rankNames[groups[0][0]]}s`,
    high_card: `${rankNames[values[0]]} High`,
  };

  return {
    name,
    rank: HAND_RANK_VALUES[name],
    tiebreaker,
    description: descriptions[name],
  };
}

/**
 * Evaluate the best 5-card hand from up to 7 cards.
 */
export function evaluateHand(cards: Card[]): HandRank {
  if (cards.length < 5) {
    throw new Error(`Need at least 5 cards, got ${cards.length}`);
  }
  if (cards.length === 5) {
    return evaluateFiveCards(cards);
  }

  const combos = getCombinations(cards, 5);
  let best: HandRank | null = null;

  for (const combo of combos) {
    const hand = evaluateFiveCards(combo);
    if (!best || compareHands(hand, best) > 0) {
      best = hand;
    }
  }

  return best!;
}

/**
 * Compare two hands. Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareHands(a: HandRank, b: HandRank): -1 | 0 | 1 {
  if (a.rank !== b.rank) {
    return a.rank > b.rank ? 1 : -1;
  }
  // Same rank — compare tiebreakers
  const len = Math.min(a.tiebreaker.length, b.tiebreaker.length);
  for (let i = 0; i < len; i++) {
    if (a.tiebreaker[i] !== b.tiebreaker[i]) {
      return a.tiebreaker[i] > b.tiebreaker[i] ? 1 : -1;
    }
  }
  return 0;
}
