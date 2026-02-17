import type { MarrakechCarpetCell, MarrakechCarpetPlacement, MarrakechPosition } from "@alpharena/shared";
import { MARRAKECH_BOARD_SIZE } from "./constants.js";

function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < MARRAKECH_BOARD_SIZE && col >= 0 && col < MARRAKECH_BOARD_SIZE;
}

function getNeighbors(pos: MarrakechPosition): MarrakechPosition[] {
  return [
    { row: pos.row - 1, col: pos.col },
    { row: pos.row + 1, col: pos.col },
    { row: pos.row, col: pos.col - 1 },
    { row: pos.row, col: pos.col + 1 },
  ];
}

function isAdjacent(a: MarrakechPosition, b: MarrakechPosition): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function placementKey(cell1: MarrakechPosition, cell2: MarrakechPosition): string {
  const [a, b] =
    cell1.row < cell2.row || (cell1.row === cell2.row && cell1.col < cell2.col)
      ? [cell1, cell2]
      : [cell2, cell1];
  return `${a.row},${a.col}-${b.row},${b.col}`;
}

export function getValidPlacements(
  board: (MarrakechCarpetCell | null)[][],
  assamPosition: MarrakechPosition,
  currentPlayerId: number,
): MarrakechCarpetPlacement[] {
  const placements: MarrakechCarpetPlacement[] = [];
  const seen = new Set<string>();

  const assamNeighbors = getNeighbors(assamPosition).filter((n) =>
    isInBounds(n.row, n.col),
  );

  for (const n1 of assamNeighbors) {
    for (const n2 of getNeighbors(n1)) {
      if (!isInBounds(n2.row, n2.col)) continue;
      if (n2.row === assamPosition.row && n2.col === assamPosition.col) continue;
      if (n2.row === n1.row && n2.col === n1.col) continue;
      if (!isAdjacent(n1, n2)) continue;
      if (!isAdjacent(n1, assamPosition) && !isAdjacent(n2, assamPosition)) continue;

      const boardCell1 = board[n1.row][n1.col];
      const boardCell2 = board[n2.row][n2.col];
      if (
        boardCell1 &&
        boardCell2 &&
        boardCell1.carpetId === boardCell2.carpetId &&
        boardCell1.playerId !== currentPlayerId
      ) {
        continue;
      }

      const key = placementKey(n1, n2);
      if (!seen.has(key)) {
        seen.add(key);
        placements.push({
          cell1: n1,
          cell2: n2,
          playerId: currentPlayerId,
          carpetId: "",
        });
      }
    }
  }

  return placements;
}
