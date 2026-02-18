import { Board, Piece, Position, PlayerColor } from '../../common/types';
import { createBoard, cloneBoard, getOpponent } from './board';
import { getLegalMoves, isValidMove, getFlippedPieces } from './rules';
import { getScore, isGameOver, getWinner } from './scoring';

export interface GameImplementation {
  createBoard(): Board;
  cloneBoard(board: Board): Board;
  getOpponent(player: Piece): Piece;
  getLegalMoves(board: Board, player: Piece): Position[];
  isValidMove(board: Board, player: Piece, row: number, col: number): boolean;
  getFlippedPieces(board: Board, player: Piece, row: number, col: number): Position[];
  getScore(board: Board): { black: number; white: number };
  isGameOver(board: Board): boolean;
  getWinner(board: Board): PlayerColor | 'draw';
}

const registry = new Map<string, GameImplementation>();

registry.set('reversi', {
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

export function getGame(gameType: string): GameImplementation {
  const impl = registry.get(gameType);
  if (!impl) {
    throw new Error(`Unknown game type: "${gameType}". Registered types: ${[...registry.keys()].join(', ')}`);
  }
  return impl;
}
