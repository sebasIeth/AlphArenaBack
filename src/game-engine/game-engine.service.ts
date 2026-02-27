import { Injectable } from '@nestjs/common';
import { GameState, Move, GameResult, Board, PlayerColor, Piece, Position, MarrakechGameState } from '../common/types';
import { getGame, GameImplementation } from './reversi/registry';
import * as marrakechEngine from './marrakech';
import { ChessEngine } from './chess';

function colorToPiece(color: PlayerColor): Piece {
  return color === 'B' ? (1 as Piece) : (2 as Piece);
}

function pieceToColor(piece: Piece): PlayerColor {
  return piece === 1 ? 'B' : 'W';
}

@Injectable()
export class GameEngineService {
  private readonly defaultEngine = new GameEngine('reversi');

  createEngine(gameType: string): GameEngine {
    return new GameEngine(gameType);
  }

  /** Convenience: create initial Reversi state */
  createInitialState(): GameState {
    return this.defaultEngine.createInitialState();
  }

  /** Convenience: get legal moves for current state */
  getLegalMoves(state: GameState): Position[] {
    return this.defaultEngine.getLegalMoves(state);
  }

  /** Convenience: apply a move */
  applyMove(state: GameState, move: Move): GameState {
    return this.defaultEngine.applyMove(state, move);
  }

  /** Convenience: check game over */
  isGameOver(state: GameState): boolean {
    return this.defaultEngine.isGameOver(state);
  }

  /** Get the Marrakech engine functions */
  getMarrakechEngine(): typeof marrakechEngine {
    return marrakechEngine;
  }

  /** Create a new ChessEngine instance */
  createChessEngine(fen?: string): ChessEngine {
    return fen ? ChessEngine.fromFen(fen) : new ChessEngine();
  }
}

export class GameEngine {
  private impl: GameImplementation;

  constructor(gameType: string) {
    this.impl = getGame(gameType);
  }

  createInitialState(): GameState {
    const board = this.impl.createBoard();
    const scores = this.impl.getScore(board);
    return {
      board,
      currentPlayer: 'B',
      moveNumber: 0,
      scores,
      gameOver: false,
      winner: null,
    };
  }

  applyMove(state: GameState, move: Move): GameState {
    if (state.gameOver) {
      throw new Error('Cannot apply move: game is already over.');
    }

    const player = colorToPiece(state.currentPlayer);

    if (!this.impl.isValidMove(state.board, player, move.row, move.col)) {
      throw new Error(`Invalid move: (${move.row}, ${move.col}) for player ${state.currentPlayer}.`);
    }

    const newBoard = this.impl.cloneBoard(state.board);
    newBoard[move.row][move.col] = player;

    const flipped = this.impl.getFlippedPieces(state.board, player, move.row, move.col);
    for (const [r, c] of flipped) {
      newBoard[r][c] = player;
    }

    const newMoveNumber = state.moveNumber + 1;
    const scores = this.impl.getScore(newBoard);

    const opponent = this.impl.getOpponent(player);
    const opponentColor = pieceToColor(opponent);
    const opponentMoves = this.impl.getLegalMoves(newBoard, opponent);
    const currentPlayerMoves = this.impl.getLegalMoves(newBoard, player);

    let nextPlayer: PlayerColor;
    let gameOver = false;
    let winner: PlayerColor | 'draw' | null = null;

    if (opponentMoves.length > 0) {
      nextPlayer = opponentColor;
    } else if (currentPlayerMoves.length > 0) {
      nextPlayer = state.currentPlayer;
    } else {
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

  getLegalMoves(state: GameState): Position[] {
    const player = colorToPiece(state.currentPlayer);
    return this.impl.getLegalMoves(state.board, player);
  }

  isGameOver(state: GameState): boolean {
    return state.gameOver || this.impl.isGameOver(state.board);
  }

  getResult(state: GameState): GameResult {
    const scores = this.impl.getScore(state.board);
    const winner = this.impl.getWinner(state.board);
    return {
      winner,
      finalScore: scores,
      totalMoves: state.moveNumber,
      reason: winner === 'draw' ? 'draw' : 'score',
    };
  }
}
