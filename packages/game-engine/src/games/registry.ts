import type { Board, Piece, Position, PlayerColor } from "@alpharena/shared";
import {
  createBoard,
  cloneBoard,
  getOpponent,
  getLegalMoves,
  isValidMove,
  getFlippedPieces,
  getScore,
  isGameOver,
  getWinner,
} from "./reversi/index.js";

/**
 * Interface that every game implementation must satisfy.
 */
export interface GameImplementation {
  createBoard(): Board;
  cloneBoard(board: Board): Board;
  getOpponent(player: Piece): Piece;
  getLegalMoves(board: Board, player: Piece): Position[];
  isValidMove(board: Board, player: Piece, row: number, col: number): boolean;
  getFlippedPieces(board: Board, player: Piece, row: number, col: number): Position[];
  getScore(board: Board): { black: number; white: number };
  isGameOver(board: Board): boolean;
  getWinner(board: Board): PlayerColor | "draw";
}

/**
 * Registry of all supported game types mapped to their implementations.
 */
const registry = new Map<string, GameImplementation>();

// Register the Reversi game implementation.
registry.set("reversi", {
  createBoard,
  cloneBoard,
  getOpponent,
  getLegalMoves,
  isValidMove,
  getFlippedPieces,
  getScore,
  isGameOver,
  getWinner,
});

/**
 * Retrieves the game implementation for a given game type.
 * Throws if the game type is not registered.
 */
export function getGame(gameType: string): GameImplementation {
  const impl = registry.get(gameType);
  if (!impl) {
    throw new Error(`Unknown game type: "${gameType}". Registered types: ${[...registry.keys()].join(", ")}`);
  }
  return impl;
}
