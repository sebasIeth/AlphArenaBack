import { Board, PlayerColor } from '../../common/types';
import { BLACK, WHITE, BOARD_SIZE } from './board';
import { getLegalMoves } from './rules';

export function getScore(board: Board): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === BLACK) black++;
      else if (board[r][c] === WHITE) white++;
    }
  }
  return { black, white };
}

export function isGameOver(board: Board): boolean {
  return getLegalMoves(board, BLACK).length === 0 && getLegalMoves(board, WHITE).length === 0;
}

export function getWinner(board: Board): PlayerColor | 'draw' {
  const score = getScore(board);
  if (score.black > score.white) return 'B';
  if (score.white > score.black) return 'W';
  return 'draw';
}
