import { Board, Piece } from '../../common/types';

export const EMPTY: Piece = 0;
export const BLACK: Piece = 1;
export const WHITE: Piece = 2;
export const BOARD_SIZE = 8;

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

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function getOpponent(player: Piece): Piece {
  return player === BLACK ? WHITE : BLACK;
}
