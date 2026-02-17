import type {
  MarrakechCarpetPlacement,
  MarrakechDirection,
  MarrakechDiceResult,
  MarrakechGameAction,
  MarrakechGameState,
} from "@alpharena/shared";
import {
  MARRAKECH_BOARD_SIZE,
  CARPETS_PER_PLAYER,
  OPPOSITE_DIRECTION,
  PLAYER_COLORS,
  STARTING_DIRHAMS,
  TURNS,
} from "./constants.js";
import { moveAssamUntilBorderOrDone, continueAfterBorderChoice } from "./assam.js";
import { getValidPlacements } from "./carpet.js";
import { rollDice } from "./dice.js";
import { calculateFinalScores } from "./scoring.js";
import { calculateTribute } from "./tribute.js";

export function createInitialState(
  numPlayers: number = 2,
  playerNames?: string[],
): MarrakechGameState {
  const board: (null)[][] = Array.from({ length: MARRAKECH_BOARD_SIZE }, () =>
    Array.from({ length: MARRAKECH_BOARD_SIZE }, () => null),
  );

  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: i,
    name: playerNames?.[i] || `Agent ${i + 1}`,
    color: PLAYER_COLORS[i],
    dirhams: STARTING_DIRHAMS,
    carpetsRemaining: CARPETS_PER_PLAYER[numPlayers],
    eliminated: false,
  }));

  return {
    numPlayers,
    board,
    assam: { position: { row: 3, col: 3 }, direction: "N" as MarrakechDirection },
    players,
    currentPlayerIndex: 0,
    phase: "orient",
    lastDiceRoll: null,
    currentTribute: null,
    validPlacements: [],
    borderChoiceInfo: null,
    movePath: [],
    actionLog: [],
    gameOver: false,
    winner: null,
    finalScores: [],
    turnNumber: 1,
  };
}

export function getValidDirections(currentDirection: MarrakechDirection): MarrakechDirection[] {
  const opposite = OPPOSITE_DIRECTION[currentDirection];
  const turns = TURNS[currentDirection];
  return ([turns.straight, turns.left, turns.right] as MarrakechDirection[]).filter(
    (d) => d !== opposite,
  );
}

export function orientAssam(
  state: MarrakechGameState,
  direction: MarrakechDirection,
): MarrakechGameState {
  const validDirs = getValidDirections(state.assam.direction);
  if (!validDirs.includes(direction)) return state;

  const player = state.players[state.currentPlayerIndex];
  const newAction: MarrakechGameAction = {
    type: "orient",
    playerId: player.id,
    description: `${player.name} oriented Assam ${direction}`,
    timestamp: Date.now(),
  };

  return {
    ...state,
    assam: { ...state.assam, direction },
    phase: "roll",
    actionLog: [...state.actionLog, newAction],
  };
}

export function rollAndMoveAssam(
  state: MarrakechGameState,
  preRolledDice?: MarrakechDiceResult,
): MarrakechGameState {
  const diceResult = preRolledDice ?? rollDice();
  const result = moveAssamUntilBorderOrDone(state.assam, diceResult.value, diceResult);

  const player = state.players[state.currentPlayerIndex];
  const rollAction: MarrakechGameAction = {
    type: "roll",
    playerId: player.id,
    description: `${player.name} rolled: ${diceResult.value}`,
    timestamp: Date.now(),
  };

  if (result.hitBorder) {
    return {
      ...state,
      assam: result.newAssam,
      lastDiceRoll: diceResult,
      movePath: result.path,
      borderChoiceInfo: result.borderInfo,
      phase: "borderChoice",
      actionLog: [...state.actionLog, rollAction],
    };
  }

  const moveAction: MarrakechGameAction = {
    type: "move",
    playerId: player.id,
    description: `Assam moved to (${result.newAssam.position.row}, ${result.newAssam.position.col})`,
    timestamp: Date.now(),
  };

  const tribute = calculateTribute(state.board, result.newAssam.position, player.id);

  return {
    ...state,
    assam: result.newAssam,
    lastDiceRoll: diceResult,
    movePath: result.path,
    currentTribute: tribute,
    borderChoiceInfo: null,
    phase: "tribute",
    actionLog: [...state.actionLog, rollAction, moveAction],
  };
}

export function chooseBorderDirection(
  state: MarrakechGameState,
  direction: MarrakechDirection,
): MarrakechGameState {
  if (!state.borderChoiceInfo) return state;

  const result = continueAfterBorderChoice(state.borderChoiceInfo, direction);
  const player = state.players[state.currentPlayerIndex];

  if (result.hitBorder) {
    return {
      ...state,
      assam: result.newAssam,
      movePath: result.path,
      borderChoiceInfo: result.borderInfo,
      phase: "borderChoice",
    };
  }

  const moveAction: MarrakechGameAction = {
    type: "move",
    playerId: player.id,
    description: `Assam moved to (${result.newAssam.position.row}, ${result.newAssam.position.col})`,
    timestamp: Date.now(),
  };

  const tribute = calculateTribute(state.board, result.newAssam.position, player.id);

  return {
    ...state,
    assam: result.newAssam,
    movePath: result.path,
    lastDiceRoll: state.lastDiceRoll,
    currentTribute: tribute,
    borderChoiceInfo: null,
    phase: "tribute",
    actionLog: [...state.actionLog, moveAction],
  };
}

export function processTribute(state: MarrakechGameState): MarrakechGameState {
  const tribute = state.currentTribute;
  const newPlayers = state.players.map((p) => ({ ...p }));
  const actions: MarrakechGameAction[] = [];
  const currentPlayer = newPlayers[state.currentPlayerIndex];

  if (tribute && tribute.amount > 0) {
    const receiver = newPlayers.find((p) => p.id === tribute.toPlayerId)!;
    const actualPayment = Math.min(tribute.amount, currentPlayer.dirhams);

    currentPlayer.dirhams -= actualPayment;
    receiver.dirhams += actualPayment;

    actions.push({
      type: "tribute",
      playerId: currentPlayer.id,
      description: `${currentPlayer.name} paid ${actualPayment} dirhams to ${receiver.name}`,
      timestamp: Date.now(),
    });

    if (currentPlayer.dirhams <= 0) {
      currentPlayer.eliminated = true;
      currentPlayer.dirhams = 0;

      const newBoard = state.board.map((row) =>
        row.map((cell) => {
          if (cell && cell.playerId === currentPlayer.id) {
            return { ...cell, playerId: -1 };
          }
          return cell;
        }),
      );

      actions.push({
        type: "eliminate",
        playerId: currentPlayer.id,
        description: `${currentPlayer.name} was eliminated`,
        timestamp: Date.now(),
      });

      const activePlayers = newPlayers.filter((p) => !p.eliminated);
      if (activePlayers.length <= 1) {
        const winner = activePlayers[0];
        const finalState: MarrakechGameState = {
          ...state,
          board: newBoard,
          players: newPlayers,
          currentTribute: null,
          phase: "gameOver",
          gameOver: true,
          winner: winner?.id ?? null,
          actionLog: [...state.actionLog, ...actions],
          finalScores: [],
        };
        finalState.finalScores = calculateFinalScores(finalState);
        return finalState;
      }

      return {
        ...state,
        board: newBoard,
        players: newPlayers,
        currentTribute: null,
        phase: "place",
        validPlacements: [],
        actionLog: [...state.actionLog, ...actions],
      };
    }
  } else {
    actions.push({
      type: "tribute",
      playerId: currentPlayer.id,
      description: tribute
        ? `${currentPlayer.name} landed on own carpet. No tribute`
        : `Assam landed on empty cell. No tribute`,
      timestamp: Date.now(),
    });
  }

  const valid = getValidPlacements(state.board, state.assam.position, currentPlayer.id);

  return {
    ...state,
    players: newPlayers,
    currentTribute: null,
    phase: "place",
    validPlacements: valid,
    selectedPlacement: null,
    actionLog: [...state.actionLog, ...actions],
  };
}

export function placeCarpet(
  state: MarrakechGameState,
  placement: MarrakechCarpetPlacement,
): MarrakechGameState {
  const player = state.players[state.currentPlayerIndex];
  const carpetNumber = CARPETS_PER_PLAYER[state.numPlayers] - player.carpetsRemaining + 1;
  const carpetId = `p${player.id}_c${String(carpetNumber).padStart(2, "0")}`;

  const newBoard = state.board.map((row) => row.map((cell) => cell));
  newBoard[placement.cell1.row][placement.cell1.col] = { playerId: player.id, carpetId };
  newBoard[placement.cell2.row][placement.cell2.col] = { playerId: player.id, carpetId };

  const newPlayers = state.players.map((p) =>
    p.id === player.id ? { ...p, carpetsRemaining: p.carpetsRemaining - 1 } : { ...p },
  );

  const action: MarrakechGameAction = {
    type: "place",
    playerId: player.id,
    description: `${player.name} placed carpet at (${placement.cell1.row},${placement.cell1.col})-(${placement.cell2.row},${placement.cell2.col})`,
    timestamp: Date.now(),
  };

  const allCarpetsPlaced = newPlayers.every(
    (p) => p.eliminated || p.carpetsRemaining === 0,
  );

  if (allCarpetsPlaced) {
    const finalState: MarrakechGameState = {
      ...state,
      board: newBoard,
      players: newPlayers,
      phase: "gameOver",
      gameOver: true,
      validPlacements: [],
      selectedPlacement: null,
      actionLog: [...state.actionLog, action],
      finalScores: [],
    };
    finalState.finalScores = calculateFinalScores(finalState);
    finalState.winner = finalState.finalScores[0]?.playerId ?? null;
    return finalState;
  }

  return advanceToNextPlayer({
    ...state,
    board: newBoard,
    players: newPlayers,
    validPlacements: [],
    selectedPlacement: null,
    actionLog: [...state.actionLog, action],
  });
}

export function advanceToNextPlayer(state: MarrakechGameState): MarrakechGameState {
  let nextIndex = (state.currentPlayerIndex + 1) % state.numPlayers;
  let checked = 0;

  while (state.players[nextIndex].eliminated && checked < state.numPlayers) {
    nextIndex = (nextIndex + 1) % state.numPlayers;
    checked++;
  }

  checked = 0;
  while (
    state.players[nextIndex].carpetsRemaining === 0 &&
    !state.players[nextIndex].eliminated &&
    checked < state.numPlayers
  ) {
    nextIndex = (nextIndex + 1) % state.numPlayers;
    checked++;
  }

  const activePlayers = state.players.filter(
    (p) => !p.eliminated && p.carpetsRemaining > 0,
  );
  if (activePlayers.length === 0) {
    const finalState: MarrakechGameState = {
      ...state,
      phase: "gameOver",
      gameOver: true,
      finalScores: [],
    };
    finalState.finalScores = calculateFinalScores(finalState);
    finalState.winner = finalState.finalScores[0]?.playerId ?? null;
    return finalState;
  }

  return {
    ...state,
    currentPlayerIndex: nextIndex,
    phase: "orient",
    lastDiceRoll: null,
    currentTribute: null,
    borderChoiceInfo: null,
    movePath: [],
    turnNumber: state.turnNumber + 1,
  };
}

export function skipPlace(state: MarrakechGameState): MarrakechGameState {
  return advanceToNextPlayer(state);
}
