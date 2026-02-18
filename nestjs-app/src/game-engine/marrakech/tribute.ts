import { MarrakechCarpetCell, MarrakechPosition, MarrakechTributeInfo } from '../../common/types';
import { MARRAKECH_BOARD_SIZE } from './constants';

function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < MARRAKECH_BOARD_SIZE && col >= 0 && col < MARRAKECH_BOARD_SIZE;
}

function floodFill(
  board: (MarrakechCarpetCell | null)[][],
  start: MarrakechPosition,
  targetPlayerId: number,
): MarrakechPosition[] {
  const visited = new Set<string>();
  const queue: MarrakechPosition[] = [start];
  const connected: MarrakechPosition[] = [];
  const key = (p: MarrakechPosition) => `${p.row},${p.col}`;
  const neighbors = [{ row: -1, col: 0 }, { row: 1, col: 0 }, { row: 0, col: 1 }, { row: 0, col: -1 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const k = key(current);
    if (visited.has(k)) continue;
    visited.add(k);
    const cell = board[current.row]?.[current.col];
    if (!cell || cell.playerId !== targetPlayerId) continue;
    connected.push(current);
    for (const n of neighbors) {
      const next = { row: current.row + n.row, col: current.col + n.col };
      if (isInBounds(next.row, next.col) && !visited.has(key(next))) {
        queue.push(next);
      }
    }
  }
  return connected;
}

export function calculateTribute(
  board: (MarrakechCarpetCell | null)[][],
  assamPosition: MarrakechPosition,
  currentPlayerId: number,
): MarrakechTributeInfo | null {
  const cell = board[assamPosition.row][assamPosition.col];
  if (!cell || cell.playerId === currentPlayerId || cell.playerId === -1) return null;
  const targetPlayerId = cell.playerId;
  const connectedCells = floodFill(board, assamPosition, targetPlayerId);
  return { fromPlayerId: currentPlayerId, toPlayerId: targetPlayerId, amount: connectedCells.length, connectedCells };
}
