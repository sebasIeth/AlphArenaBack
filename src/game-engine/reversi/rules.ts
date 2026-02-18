import { Board, Piece, Position } from '../../common/types';
import { EMPTY, BOARD_SIZE, getOpponent } from './board';

const DIRECTIONS: readonly Position[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function getFlippedPieces(board: Board, player: Piece, row: number, col: number): Position[] {
  if (board[row][col] !== EMPTY) return [];
  const opponent = getOpponent(player);
  const allFlipped: Position[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const flippedInDir: Position[] = [];
    let r = row + dr;
    let c = col + dc;

    while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === opponent) {
      flippedInDir.push([r, c]);
      r += dr;
      c += dc;
    }

    if (flippedInDir.length > 0 && r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === player) {
      allFlipped.push(...flippedInDir);
    }
  }

  return allFlipped;
}

export function isValidMove(board: Board, player: Piece, row: number, col: number): boolean {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false;
  if (board[row][col] !== EMPTY) return false;
  return getFlippedPieces(board, player, row, col).length > 0;
}

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
