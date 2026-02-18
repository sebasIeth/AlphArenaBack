import {
  MarrakechAssam, MarrakechBorderChoiceInfo, MarrakechBorderOption,
  MarrakechDirection, MarrakechDiceResult, MarrakechPosition,
} from '../../common/types';
import { MARRAKECH_BOARD_SIZE, DIRECTION_VECTORS, OPPOSITE_DIRECTION } from './constants';

function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < MARRAKECH_BOARD_SIZE && col >= 0 && col < MARRAKECH_BOARD_SIZE;
}

function getBorderTurnOptions(pos: MarrakechPosition, exitDirection: MarrakechDirection): MarrakechBorderOption[] {
  const perpDirs: MarrakechDirection[] =
    exitDirection === 'N' || exitDirection === 'S' ? ['W', 'E'] : ['N', 'S'];
  const labels: Record<MarrakechDirection, string> = { N: 'Up', S: 'Down', E: 'Right', W: 'Left' };
  const options: MarrakechBorderOption[] = [];
  for (const dir of perpDirs) {
    const vec = DIRECTION_VECTORS[dir];
    if (isInBounds(pos.row + vec.row, pos.col + vec.col)) {
      options.push({ direction: dir, label: labels[dir] });
    }
  }
  return options;
}

export function moveAssamUntilBorderOrDone(
  assam: MarrakechAssam,
  steps: number,
  diceResult: MarrakechDiceResult,
  pathSoFar: MarrakechPosition[] = [],
): {
  newAssam: MarrakechAssam;
  path: MarrakechPosition[];
  hitBorder: boolean;
  remainingSteps: number;
  borderInfo: MarrakechBorderChoiceInfo | null;
} {
  const movePath: MarrakechPosition[] = pathSoFar.length > 0 ? [...pathSoFar] : [{ ...assam.position }];
  let currentPos = { ...assam.position };
  let currentDir = assam.direction;
  let remainingSteps = steps;

  while (remainingSteps > 0) {
    const vector = DIRECTION_VECTORS[currentDir];
    const nextRow = currentPos.row + vector.row;
    const nextCol = currentPos.col + vector.col;

    if (isInBounds(nextRow, nextCol)) {
      currentPos = { row: nextRow, col: nextCol };
      movePath.push({ ...currentPos });
      remainingSteps--;
    } else {
      const options = getBorderTurnOptions(currentPos, currentDir);
      return {
        newAssam: { position: currentPos, direction: currentDir },
        path: movePath,
        hitBorder: true,
        remainingSteps,
        borderInfo: { position: currentPos, currentDirection: currentDir, remainingSteps, options, pathSoFar: movePath, diceResult },
      };
    }
  }

  return {
    newAssam: { position: currentPos, direction: currentDir },
    path: movePath,
    hitBorder: false,
    remainingSteps: 0,
    borderInfo: null,
  };
}

export function continueAfterBorderChoice(
  borderInfo: MarrakechBorderChoiceInfo,
  chosenDirection: MarrakechDirection,
): {
  newAssam: MarrakechAssam;
  path: MarrakechPosition[];
  hitBorder: boolean;
  remainingSteps: number;
  borderInfo: MarrakechBorderChoiceInfo | null;
} {
  const vec = DIRECTION_VECTORS[chosenDirection];
  const newPos: MarrakechPosition = { row: borderInfo.position.row + vec.row, col: borderInfo.position.col + vec.col };
  const newDirection = OPPOSITE_DIRECTION[borderInfo.currentDirection];
  const pathSoFar = [...borderInfo.pathSoFar, { ...newPos }];
  const stepsAfterTurn = borderInfo.remainingSteps - 1;
  const assam: MarrakechAssam = { position: newPos, direction: newDirection };
  return moveAssamUntilBorderOrDone(assam, stepsAfterTurn, borderInfo.diceResult, pathSoFar);
}
