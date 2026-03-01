import { PokerGameState, PokerAction, PokerLegalActions } from '../../common/types';

function opponent(side: 'a' | 'b'): 'a' | 'b' {
  return side === 'a' ? 'b' : 'a';
}

export function getLegalActions(state: PokerGameState): PokerLegalActions {
  const player = state.players[state.currentPlayerSide];
  const opp = state.players[opponent(state.currentPlayerSide)];

  const toCall = opp.currentBet - player.currentBet;
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
    const minRaiseTotal = opp.currentBet + minRaiseAmount;
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
  const opp = s.players[opponent(action.playerSide)];

  switch (action.type) {
    case 'fold':
      player.hasFolded = true;
      break;

    case 'check':
      // No money moves
      break;

    case 'call': {
      const toCall = Math.min(opp.currentBet - player.currentBet, player.stack);
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
      if (player.currentBet > opp.currentBet) {
        s.lastAggressor = action.playerSide;
      }
      break;
    }
  }

  s.actionsThisStreet.push(action);
  s.actionHistory.push(action);

  // Advance current player (if not fold and street continues)
  if (action.type !== 'fold') {
    s.currentPlayerSide = opponent(action.playerSide);
  }

  return s;
}

export function isStreetOver(state: PokerGameState): boolean {
  const a = state.players.a;
  const b = state.players.b;

  // Someone folded
  if (a.hasFolded || b.hasFolded) return true;

  // Both all-in
  if (a.isAllIn && b.isAllIn) return true;

  // One all-in and other has matched or exceeded
  if (a.isAllIn && state.actionsThisStreet.some(act => act.playerSide === 'b' && act.type !== 'fold')) return true;
  if (b.isAllIn && state.actionsThisStreet.some(act => act.playerSide === 'a' && act.type !== 'fold')) return true;

  const actions = state.actionsThisStreet;
  if (actions.length < 2) return false;

  // Both have acted and bets are equal
  const aActed = actions.some(act => act.playerSide === 'a');
  const bActed = actions.some(act => act.playerSide === 'b');

  if (aActed && bActed && a.currentBet === b.currentBet) {
    // Check the last action wasn't a raise (opponent needs chance to respond)
    const lastAction = actions[actions.length - 1];
    if (lastAction.type !== 'raise') return true;
  }

  return false;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
