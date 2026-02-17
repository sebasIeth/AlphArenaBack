import type {
  GameState,
  Move,
  GameResult,
  Board,
  PlayerColor,
  Piece,
  Position,
} from "@alpharena/shared";
import { getGame, type GameImplementation } from "./games/registry.js";

/** Map PlayerColor to internal piece value. */
function colorToPiece(color: PlayerColor): Piece {
  return color === "B" ? (1 as Piece) : (2 as Piece);
}

/** Map internal piece value to PlayerColor. */
function pieceToColor(piece: Piece): PlayerColor {
  return piece === 1 ? "B" : "W";
}

/**
 * GameEngine wraps a game implementation behind a high-level API
 * that operates on shared GameState / Move / GameResult types.
 */
export class GameEngine {
  private impl: GameImplementation;
  private gameType: string;

  constructor(gameType: string) {
    this.gameType = gameType;
    this.impl = getGame(gameType);
  }

  /**
   * Creates the initial GameState for a new match.
   * Black always moves first in Reversi.
   */
  createInitialState(): GameState {
    const board = this.impl.createBoard();
    const scores = this.impl.getScore(board);

    return {
      board,
      currentPlayer: "B",
      moveNumber: 0,
      scores,
      gameOver: false,
      winner: null,
    };
  }

  /**
   * Validates and applies a move, returning a new GameState.
   * If the opponent has no legal moves after this move, the current
   * player retains the turn. If neither player has moves, the game ends.
   */
  applyMove(state: GameState, move: Move): GameState {
    if (state.gameOver) {
      throw new Error("Cannot apply move: game is already over.");
    }

    const player = colorToPiece(state.currentPlayer);

    if (!this.impl.isValidMove(state.board, player, move.row, move.col)) {
      throw new Error(
        `Invalid move: (${move.row}, ${move.col}) for player ${state.currentPlayer}.`,
      );
    }

    // Clone the board so we don't mutate the original state.
    const newBoard = this.impl.cloneBoard(state.board);

    // Place the piece.
    newBoard[move.row][move.col] = player;

    // Flip captured pieces.
    const flipped = this.impl.getFlippedPieces(state.board, player, move.row, move.col);
    for (const [r, c] of flipped) {
      newBoard[r][c] = player;
    }

    const newMoveNumber = state.moveNumber + 1;
    const scores = this.impl.getScore(newBoard);

    // Determine next player.
    const opponent = this.impl.getOpponent(player);
    const opponentColor = pieceToColor(opponent);
    const opponentMoves = this.impl.getLegalMoves(newBoard, opponent);
    const currentPlayerMoves = this.impl.getLegalMoves(newBoard, player);

    let nextPlayer: PlayerColor;
    let gameOver = false;
    let winner: PlayerColor | "draw" | null = null;

    if (opponentMoves.length > 0) {
      // Normal case: opponent can move.
      nextPlayer = opponentColor;
    } else if (currentPlayerMoves.length > 0) {
      // Opponent has no moves; current player goes again.
      nextPlayer = state.currentPlayer;
    } else {
      // Neither player can move: game over.
      nextPlayer = opponentColor;
      gameOver = true;
      winner = this.impl.getWinner(newBoard);
    }

    return {
      board: newBoard,
      currentPlayer: nextPlayer,
      moveNumber: newMoveNumber,
      scores,
      gameOver,
      winner,
    };
  }

  /**
   * Returns the legal moves for the current player as an array of Positions.
   */
  getLegalMoves(state: GameState): Position[] {
    const player = colorToPiece(state.currentPlayer);
    return this.impl.getLegalMoves(state.board, player);
  }

  /**
   * Returns true if the game is over (neither player has legal moves).
   */
  isGameOver(state: GameState): boolean {
    return state.gameOver || this.impl.isGameOver(state.board);
  }

  /**
   * Returns the final GameResult for a finished game.
   * Should only be called when the game is over.
   */
  getResult(state: GameState): GameResult {
    const scores = this.impl.getScore(state.board);
    const winner = this.impl.getWinner(state.board);

    return {
      winner,
      finalScore: scores,
      totalMoves: state.moveNumber,
      reason: winner === "draw" ? "draw" : "score",
    };
  }
}
