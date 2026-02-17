import type { Board, PlayerColor } from "@alpharena/shared";
import { BLACK, WHITE, BOARD_SIZE } from "./board.js";
import { getLegalMoves } from "./rules.js";

/**
 * Counts the number of black and white pieces on the board.
 */
export function getScore(board: Board): { black: number; white: number } {
  let black = 0;
  let white = 0;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === BLACK) {
        black++;
      } else if (board[r][c] === WHITE) {
        white++;
      }
    }
  }

  return { black, white };
}

/**
 * Returns true if the game is over.
 * The game is over when neither player has any legal moves.
 */
export function isGameOver(board: Board): boolean {
  return (
    getLegalMoves(board, BLACK).length === 0 &&
    getLegalMoves(board, WHITE).length === 0
  );
}

/**
 * Determines the winner based on piece count.
 * Returns "B" if black has more pieces, "W" if white has more, or "draw" if equal.
 */
export function getWinner(board: Board): PlayerColor | "draw" {
  const score = getScore(board);
  if (score.black > score.white) {
    return "B";
  } else if (score.white > score.black) {
    return "W";
  }
  return "draw";
}
