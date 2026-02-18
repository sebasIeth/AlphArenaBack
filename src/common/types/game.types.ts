export type Piece = 0 | 1 | 2;
export type Board = Piece[][];
export type Position = [number, number];

export type PlayerColor = 'B' | 'W';
export type Side = 'a' | 'b';

export interface GameState {
  board: Board;
  currentPlayer: PlayerColor;
  moveNumber: number;
  scores: { black: number; white: number };
  gameOver: boolean;
  winner: PlayerColor | 'draw' | null;
}

export interface Move {
  row: number;
  col: number;
}

export interface GameResult {
  winner: PlayerColor | 'draw';
  finalScore: { black: number; white: number };
  totalMoves: number;
  reason: 'score' | 'timeout' | 'forfeit' | 'disconnect' | 'draw';
}

export interface MoveRequest {
  matchId: string;
  gameType: string;
  board: number[][];
  yourPiece: PlayerColor;
  legalMoves: Position[];
  moveNumber: number;
  timeRemainingMs: number;
}

export interface MoveResponse {
  move: Position;
}
