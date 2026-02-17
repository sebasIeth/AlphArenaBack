import type { Board, Piece } from "@alpharena/shared";

export const EMPTY: Piece = 0;
export const BLACK: Piece = 1;
export const WHITE: Piece = 2;
export const BOARD_SIZE = 8;

/**
 * Creates a new 8x8 Reversi board with the standard initial setup.
 * The four center squares are populated:
 *   row 3, col 3 = WHITE
 *   row 3, col 4 = BLACK
 *   row 4, col 3 = BLACK
 *   row 4, col 4 = WHITE
 */
export function createBoard(): Board {
  const board: Board = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: Piece[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push(EMPTY);
    }
    board.push(row);
  }

  board[3][3] = WHITE;
  board[3][4] = BLACK;
  board[4][3] = BLACK;
  board[4][4] = WHITE;

  return board;
}

/**
 * Returns a deep copy of the given board.
 */
export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/**
 * Returns the opponent piece value for the given player.
 * BLACK (1) -> WHITE (2) and WHITE (2) -> BLACK (1).
 */
export function getOpponent(player: Piece): Piece {
  return player === BLACK ? WHITE : BLACK;
}
