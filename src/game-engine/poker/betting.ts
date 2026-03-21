import { PokerGameState, PokerAction, PokerLegalActions } from '../../common/types';
import { nextActiveSeat, getActiveSides, getActableSides, getMaxBet } from './engine';

export function getLegalActions(state: PokerGameState): PokerLegalActions {
  const player = state.players[state.currentPlayerSide];
  const maxBet = getMaxBet(state);
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
      let prevBet = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (streetActions[j].playerSide !== streetActions[i].playerSide) {
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

export function applyAction(state: PokerGameState, action: PokerAction): PokerGameState {
  const s = deepClone(state);
  const player = s.players[action.playerSide];
  const maxBet = getMaxBet(s);

  switch (action.type) {
    case 'fold':
      player.hasFolded = true;
      break;

    case 'check':
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
      s.lastAggressor = action.playerSide;
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
        s.lastAggressor = action.playerSide;
      }
      break;
    }
  }

  s.actionsThisStreet.push(action);
  s.actionHistory.push(action);

  // Advance to next active, non-all-in player
  if (action.type !== 'fold') {
    s.currentPlayerSide = nextActiveSeat(s, action.playerSide, true);
  } else {
    // After fold, advance to next active player (may include all-in for street-over check)
    const remaining = getActableSides(s);
    if (remaining.length > 0) {
      s.currentPlayerSide = nextActiveSeat(s, action.playerSide, true);
    }
  }

  return s;
}

export function isStreetOver(state: PokerGameState): boolean {
  const active = getActiveSides(state);
  const actable = getActableSides(state);

  // Only 1 player left (everyone else folded)
  if (active.length <= 1) return true;

  // All active players are all-in
  if (actable.length === 0) return true;

  // Only 1 player can act (rest are all-in) and they've matched or it's their turn
  if (actable.length === 1) {
    const p = state.players[actable[0]];
    const maxBet = getMaxBet(state);
    // If the actable player has matched the max bet and has acted this street
    const hasActed = state.actionsThisStreet.some(a => a.playerSide === actable[0]);
    if (p.currentBet === maxBet && hasActed) return true;
  }

  const actions = state.actionsThisStreet;
  if (actions.length === 0) return false;

  // All actable players must have acted this street
  const maxBet = getMaxBet(state);
  for (const side of actable) {
    const p = state.players[side];
    // Must have equal bet
    if (p.currentBet !== maxBet) return false;
    // Must have acted this street
    const acted = actions.some(a => a.playerSide === side);
    if (!acted) return false;
  }

  // If the last action was a raise, the raiser's opponents need to respond
  const lastAction = actions[actions.length - 1];
  if (lastAction.type === 'raise' || lastAction.type === 'all_in') {
    // Check if everyone else has acted AFTER the last raise
    const lastRaiseIdx = actions.length - 1;
    for (const side of actable) {
      if (side === lastAction.playerSide) continue;
      const actedAfter = actions.slice(lastRaiseIdx + 1).some(a => a.playerSide === side);
      if (!actedAfter) return false;
    }
  }

  return true;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
