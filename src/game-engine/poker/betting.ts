import { PokerGameState, PokerAction, PokerLegalActions } from '../../common/types';

/**
 * Find the highest current bet among all players.
 */
function highestBet(state: PokerGameState): number {
  let max = 0;
  for (const p of state.players) {
    if (p.currentBet > max) max = p.currentBet;
  }
  return max;
}

export function getLegalActions(state: PokerGameState): PokerLegalActions {
  const player = state.players[state.currentPlayerIndex];
  const maxBet = highestBet(state);
  const toCall = maxBet - player.currentBet;
  const canAffordCall = player.stack >= toCall;

  const result: PokerLegalActions = {
    canFold: true,
    canCheck: toCall === 0,
    canCall: toCall > 0 && canAffordCall && player.stack > toCall,
    callAmount: Math.min(toCall, player.stack),
    canRaise: false,
    minRaise: 0,
    maxRaise: 0,
    canAllIn: player.stack > 0 && !player.isAllIn,
    allInAmount: player.stack,
  };

  // Raise: must be at least the size of the last raise (or big blind if no raise yet)
  if (player.stack > toCall) {
    const lastRaiseSize = getLastRaiseSize(state);
    const minRaiseAmount = Math.max(lastRaiseSize, state.bigBlind);
    const minRaiseTotal = maxBet + minRaiseAmount;
    const maxRaiseTotal = player.stack + player.currentBet;

    if (player.stack > toCall + minRaiseAmount) {
      result.canRaise = true;
      result.minRaise = minRaiseTotal;
      result.maxRaise = maxRaiseTotal;
    }
  }

  return result;
}

function getLastRaiseSize(state: PokerGameState): number {
  const streetActions = state.actionsThisStreet;
  for (let i = streetActions.length - 1; i >= 0; i--) {
    if (streetActions[i].type === 'raise' && streetActions[i].amount != null) {
      // Find previous bet level to calculate raise size
      let prevBet = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (streetActions[j].playerIndex !== streetActions[i].playerIndex) {
          if (streetActions[j].type === 'raise' || streetActions[j].type === 'call' || streetActions[j].type === 'all_in') {
            prevBet = streetActions[j].amount || 0;
            break;
          }
        }
      }
      return (streetActions[i].amount || 0) - prevBet;
    }
  }
  return state.bigBlind;
}

/**
 * Get the next active player index (not folded, not all-in, not eliminated) after the given index.
 * Returns -1 if no active player found.
 */
export function nextActivePlayer(state: PokerGameState, fromIndex: number): number {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIndex + i) % n;
    const p = state.players[idx];
    if (!p.hasFolded && !p.isAllIn && !p.isEliminated && p.stack > 0) {
      return idx;
    }
  }
  return -1;
}

export function applyAction(state: PokerGameState, action: PokerAction): PokerGameState {
  const s = deepClone(state);
  const player = s.players[action.playerIndex];
  const maxBet = highestBet(s);

  switch (action.type) {
    case 'fold':
      player.hasFolded = true;
      break;

    case 'check':
      // No money moves
      break;

    case 'call': {
      const toCall = Math.min(maxBet - player.currentBet, player.stack);
      player.stack -= toCall;
      player.currentBet += toCall;
      player.totalBetThisHand += toCall;
      s.pot += toCall;
      if (player.stack === 0) player.isAllIn = true;
      break;
    }

    case 'raise': {
      const raiseTotal = action.amount!;
      const additional = raiseTotal - player.currentBet;
      player.stack -= additional;
      player.currentBet = raiseTotal;
      player.totalBetThisHand += additional;
      s.pot += additional;
      s.lastAggressor = action.playerIndex;
      if (player.stack === 0) player.isAllIn = true;
      break;
    }

    case 'all_in': {
      const allInAmount = player.stack;
      player.currentBet += allInAmount;
      player.totalBetThisHand += allInAmount;
      s.pot += allInAmount;
      player.stack = 0;
      player.isAllIn = true;
      if (player.currentBet > maxBet) {
        s.lastAggressor = action.playerIndex;
      }
      break;
    }
  }

  s.actionsThisStreet.push(action);
  s.actionHistory.push(action);

  // Advance to next active player (if not fold and street continues)
  if (action.type !== 'fold') {
    const next = nextActivePlayer(s, action.playerIndex);
    if (next !== -1) {
      s.currentPlayerIndex = next;
    }
  } else {
    // After fold, advance to next active player
    const next = nextActivePlayer(s, action.playerIndex);
    if (next !== -1) {
      s.currentPlayerIndex = next;
    }
  }

  return s;
}

/**
 * Check if the current betting street is over.
 * A street is over when:
 * 1. Only one non-folded player remains (everyone else folded), OR
 * 2. All active (non-folded, non-all-in) players have acted and bets are equal, OR
 * 3. All non-folded players are all-in
 */
export function isStreetOver(state: PokerGameState): boolean {
  const nonFolded = state.players.filter(p => !p.hasFolded && !p.isEliminated);

  // Only one player left — hand is over
  if (nonFolded.length <= 1) return true;

  // All non-folded players are all-in
  const active = nonFolded.filter(p => !p.isAllIn);
  if (active.length === 0) return true;

  // If only one player is active (rest are all-in) and they've matched the bet
  if (active.length === 1) {
    const p = active[0];
    const maxBet = highestBet(state);
    // The active player must have had a chance to act
    const hasActed = state.actionsThisStreet.some(a => a.playerIndex === p.seatIndex);
    if (hasActed && p.currentBet >= maxBet) return true;
    // If they haven't acted yet but there's nothing to call
    if (!hasActed && p.currentBet === maxBet) return false; // still needs to act
    if (hasActed) return true;
    return false;
  }

  // All active players must have acted at least once
  const actions = state.actionsThisStreet;
  if (actions.length < active.length) return false;

  const maxBet = highestBet(state);
  const allActiveActed = active.every(p =>
    actions.some(a => a.playerIndex === p.seatIndex),
  );

  if (!allActiveActed) return false;

  // All active bets must be equal
  const allBetsEqual = active.every(p => p.currentBet === maxBet);
  if (!allBetsEqual) return false;

  // The last action must not be a raise (opponent needs to respond)
  const lastAction = actions[actions.length - 1];
  if (lastAction.type === 'raise' || lastAction.type === 'all_in') {
    // Check if the raiser was the last to act and everyone after has responded
    const raiserIndex = lastAction.playerIndex;
    // Everyone after the raiser (in turn order) must have acted after this raise
    const raiseActionIdx = actions.length - 1;
    const playersToRespond = active.filter(p => p.seatIndex !== raiserIndex);
    const allResponded = playersToRespond.every(p =>
      actions.slice(raiseActionIdx + 1).some(a => a.playerIndex === p.seatIndex),
    );
    if (!allResponded && lastAction.type === 'raise') return false;
  }

  return true;
}

/**
 * Calculate side pots from player bets.
 * Returns an array of pots with eligible player indices.
 */
export function calculateSidePots(players: { seatIndex: number; totalBetThisHand: number; hasFolded: boolean; isEliminated: boolean }[]): { amount: number; eligibleIndices: number[] }[] {
  const activePlayers = players.filter(p => !p.isEliminated);
  if (activePlayers.length === 0) return [];

  // Get unique bet levels from all-in players (sorted ascending)
  const betLevels = [...new Set(activePlayers.map(p => p.totalBetThisHand))].sort((a, b) => a - b);

  const pots: { amount: number; eligibleIndices: number[] }[] = [];
  let prevLevel = 0;

  for (const level of betLevels) {
    if (level === prevLevel) continue;

    const diff = level - prevLevel;
    let potAmount = 0;
    const eligible: number[] = [];

    for (const p of activePlayers) {
      if (p.totalBetThisHand > prevLevel) {
        const contribution = Math.min(p.totalBetThisHand - prevLevel, diff);
        potAmount += contribution;
      }
      // Eligible if not folded and bet at least this level
      if (!p.hasFolded && p.totalBetThisHand >= level) {
        eligible.push(p.seatIndex);
      }
    }

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligibleIndices: eligible });
    }

    prevLevel = level;
  }

  return pots;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
