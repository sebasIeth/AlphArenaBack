import { Chess } from 'chess.js';
import { ChessState, ChessUciMove } from '../../common/types/chess.types';
import { chessToBoard } from './board';

export class ChessEngine {
  private chess: Chess;

  constructor(fen?: string) {
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  getFen(): string {
    return this.chess.fen();
  }

  getBoard(): number[][] {
    return chessToBoard(this.chess);
  }

  getLegalMovesUci(): ChessUciMove[] {
    const moves = this.chess.moves({ verbose: true });
    return moves.map((m) => m.from + m.to + (m.promotion || ''));
  }

  isLegalUci(uci: ChessUciMove): boolean {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;

    const legalMoves = this.chess.moves({ verbose: true });
    return legalMoves.some(
      (m) => m.from === from && m.to === to && (m.promotion || '') === (promotion || ''),
    );
  }

  applyMoveUci(uci: ChessUciMove): boolean {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;

    const result = this.chess.move({ from, to, promotion });
    return result !== null;
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  isCheckmate(): boolean {
    return this.chess.isCheckmate();
  }

  isCheck(): boolean {
    return this.chess.isCheck();
  }

  isDraw(): boolean {
    return this.chess.isDraw();
  }

  isStalemate(): boolean {
    return this.chess.isStalemate();
  }

  isThreefoldRepetition(): boolean {
    return this.chess.isThreefoldRepetition();
  }

  isInsufficientMaterial(): boolean {
    return this.chess.isInsufficientMaterial();
  }

  /** Returns 'white', 'black', or 'draw'. Only meaningful when game is over. */
  getWinner(): 'white' | 'black' | 'draw' | null {
    if (!this.isGameOver()) return null;
    if (this.isDraw()) return 'draw';
    // If checkmate, the current turn is the loser (they're in checkmate)
    return this.chess.turn() === 'w' ? 'black' : 'white';
  }

  /** Returns the side to move: 'white' or 'black' */
  getTurn(): 'white' | 'black' {
    return this.chess.turn() === 'w' ? 'white' : 'black';
  }

  getMoveNumber(): number {
    return this.chess.moveNumber();
  }

  /** Simple material score: positive = white advantage */
  getMaterialScore(): number {
    const board = this.chess.board();
    const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let score = 0;
    for (const row of board) {
      for (const piece of row) {
        if (piece) {
          const val = values[piece.type] ?? 0;
          score += piece.color === 'w' ? val : -val;
        }
      }
    }
    return score;
  }

  getPgn(): string {
    return this.chess.pgn();
  }

  getHistory(): string[] {
    return this.chess.history();
  }

  getState(): ChessState {
    return {
      fen: this.getFen(),
      moveHistory: [], // caller should maintain this
      pgn: this.getPgn(),
    };
  }

  clone(): ChessEngine {
    return ChessEngine.fromFen(this.getFen());
  }

  static fromFen(fen: string): ChessEngine {
    return new ChessEngine(fen);
  }
}
