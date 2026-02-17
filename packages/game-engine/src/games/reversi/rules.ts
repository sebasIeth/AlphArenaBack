import type { Board, Piece, Position } from "@alpharena/shared";
import { EMPTY, BOARD_SIZE, getOpponent } from "./board.js";

/** All 8 directions as [deltaRow, deltaCol] pairs. */
const DIRECTIONS: readonly Position[] = [
  [-1, -1], // up-left
  [-1, 0],  // up
  [-1, 1],  // up-right
  [0, -1],  // left
  [0, 1],   // right
  [1, -1],  // down-left
  [1, 0],   // down
  [1, 1],   // down-right
];

/**
 * Returns the list of opponent pieces that would be flipped
 * if `player` places a piece at (row, col) on the given board.
 *
 * A direction contributes flips only if there is a contiguous line
 * of one or more opponent pieces followed by one of the player's
 * own pieces (with no empty squares in between).
 */
export function getFlippedPieces(
  board: Board,
  player: Piece,
  row: number,
  col: number,
): Position[] {
  if (board[row][col] !== EMPTY) {
    return [];
  }

  const opponent = getOpponent(player);
  const allFlipped: Position[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const flippedInDir: Position[] = [];
    let r = row + dr;
    let c = col + dc;

    // Walk along the direction while we see opponent pieces.
    while (
      r >= 0 && r < BOARD_SIZE &&
      c >= 0 && c < BOARD_SIZE &&
      board[r][c] === opponent
    ) {
      flippedInDir.push([r, c]);
      r += dr;
      c += dc;
    }

    // The line is valid only if it ends with the player's own piece.
    if (
      flippedInDir.length > 0 &&
      r >= 0 && r < BOARD_SIZE &&
      c >= 0 && c < BOARD_SIZE &&
      board[r][c] === player
    ) {
      allFlipped.push(...flippedInDir);
    }
  }

  return allFlipped;
}

/**
 * Checks whether placing `player` at (row, col) is a valid move.
 * A move is valid when:
 *   1. The position is within bounds.
 *   2. The cell is empty.
 *   3. At least one opponent piece would be flipped.
 */
export function isValidMove(
  board: Board,
  player: Piece,
  row: number,
  col: number,
): boolean {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return false;
  }
  if (board[row][col] !== EMPTY) {
    return false;
  }
  return getFlippedPieces(board, player, row, col).length > 0;
}

/**
 * Returns all legal moves for the given player on the given board.
 * Each move is a [row, col] pair.
 */
export function getLegalMoves(board: Board, player: Piece): Position[] {
  const moves: Position[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (isValidMove(board, player, r, c)) {
        moves.push([r, c]);
      }
    }
  }
  return moves;
}
