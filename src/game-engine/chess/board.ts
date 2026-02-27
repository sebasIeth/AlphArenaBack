import { Chess, Square } from 'chess.js';

// Piece encoding for number[][] board
// 0=empty, 1=wPawn, 2=wKnight, 3=wBishop, 4=wRook, 5=wQueen, 6=wKing
// 7=bPawn, 8=bKnight, 9=bBishop, 10=bRook, 11=bQueen, 12=bKing

const PIECE_MAP: Record<string, Record<string, number>> = {
  w: { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 },
  b: { p: 7, n: 8, b: 9, r: 10, q: 11, k: 12 },
};

const FILES = 'abcdefgh';

export function chessToBoard(chess: Chess): number[][] {
  const board: number[][] = [];
  const internalBoard = chess.board();

  for (let rank = 0; rank < 8; rank++) {
    const row: number[] = [];
    for (let file = 0; file < 8; file++) {
      const piece = internalBoard[rank][file];
      if (piece) {
        row.push(PIECE_MAP[piece.color][piece.type]);
      } else {
        row.push(0);
      }
    }
    board.push(row);
  }
  return board;
}

export function squareToPosition(square: Square): [number, number] {
  const file = square.charCodeAt(0) - 97; // 'a' = 0
  const rank = 8 - parseInt(square[1], 10);  // '8' = row 0
  return [rank, file];
}

export function positionToSquare(row: number, col: number): Square {
  return (FILES[col] + (8 - row)) as Square;
}
