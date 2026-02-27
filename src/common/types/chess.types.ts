export type ChessUciMove = string; // e.g. "e2e4", "e7e8q"

export interface ChessMoveRequest {
  matchId: string;
  gameType: 'chess';
  fen: string;
  board: number[][];
  yourColor: 'white' | 'black';
  legalMoves: ChessUciMove[];
  moveNumber: number;
  timeRemainingMs: number;
  isCheck: boolean;
  moveHistory: ChessUciMove[];
}

export interface ChessMoveResponse {
  move: ChessUciMove;
}

export interface ChessState {
  fen: string;
  moveHistory: ChessUciMove[];
  pgn: string;
}
