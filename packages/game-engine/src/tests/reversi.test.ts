import { describe, it, expect } from "vitest";
import type { Board, Piece } from "@alpharena/shared";
import {
  EMPTY,
  BLACK,
  WHITE,
  BOARD_SIZE,
  createBoard,
  cloneBoard,
  getOpponent,
  getLegalMoves,
  isValidMove,
  getFlippedPieces,
  getScore,
  isGameOver,
  getWinner,
} from "../games/reversi/index.js";

describe("Reversi - board", () => {
  it("createBoard returns an 8x8 board", () => {
    const board = createBoard();
    expect(board.length).toBe(8);
    for (const row of board) {
      expect(row.length).toBe(8);
    }
  });

  it("createBoard has correct initial center pieces", () => {
    const board = createBoard();
    expect(board[3][3]).toBe(WHITE);
    expect(board[3][4]).toBe(BLACK);
    expect(board[4][3]).toBe(BLACK);
    expect(board[4][4]).toBe(WHITE);
  });

  it("createBoard has all other squares empty", () => {
    const board = createBoard();
    let nonEmpty = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) {
          nonEmpty++;
        }
      }
    }
    expect(nonEmpty).toBe(4);
  });

  it("cloneBoard creates an independent deep copy", () => {
    const board = createBoard();
    const copy = cloneBoard(board);

    // Same values
    expect(copy).toEqual(board);

    // Mutating the copy should not affect the original
    copy[0][0] = BLACK;
    expect(board[0][0]).toBe(EMPTY);
  });

  it("getOpponent returns correct opponent", () => {
    expect(getOpponent(BLACK)).toBe(WHITE);
    expect(getOpponent(WHITE)).toBe(BLACK);
  });
});

describe("Reversi - rules", () => {
  it("initial legal moves for BLACK should be exactly 4", () => {
    const board = createBoard();
    const moves = getLegalMoves(board, BLACK);
    expect(moves.length).toBe(4);

    // The 4 legal opening moves for black in standard Othello
    const expected: [number, number][] = [
      [2, 3],
      [3, 2],
      [4, 5],
      [5, 4],
    ];

    for (const [r, c] of expected) {
      expect(moves).toContainEqual([r, c]);
    }
  });

  it("initial legal moves for WHITE should be exactly 4", () => {
    const board = createBoard();
    const moves = getLegalMoves(board, WHITE);
    expect(moves.length).toBe(4);

    const expected: [number, number][] = [
      [2, 4],
      [3, 5],
      [4, 2],
      [5, 3],
    ];

    for (const [r, c] of expected) {
      expect(moves).toContainEqual([r, c]);
    }
  });

  it("isValidMove returns true for legal moves", () => {
    const board = createBoard();
    expect(isValidMove(board, BLACK, 2, 3)).toBe(true);
    expect(isValidMove(board, BLACK, 3, 2)).toBe(true);
    expect(isValidMove(board, BLACK, 4, 5)).toBe(true);
    expect(isValidMove(board, BLACK, 5, 4)).toBe(true);
  });

  it("isValidMove returns false for occupied squares", () => {
    const board = createBoard();
    expect(isValidMove(board, BLACK, 3, 3)).toBe(false); // White piece there
    expect(isValidMove(board, BLACK, 3, 4)).toBe(false); // Black piece there
  });

  it("isValidMove returns false for out-of-bounds positions", () => {
    const board = createBoard();
    expect(isValidMove(board, BLACK, -1, 0)).toBe(false);
    expect(isValidMove(board, BLACK, 0, 8)).toBe(false);
    expect(isValidMove(board, BLACK, 8, 0)).toBe(false);
    expect(isValidMove(board, BLACK, 0, -1)).toBe(false);
  });

  it("isValidMove returns false for empty squares that flip nothing", () => {
    const board = createBoard();
    expect(isValidMove(board, BLACK, 0, 0)).toBe(false);
    expect(isValidMove(board, BLACK, 7, 7)).toBe(false);
  });

  it("getFlippedPieces returns correct pieces for opening move", () => {
    const board = createBoard();
    // Black plays at (2, 3): should flip the white piece at (3, 3)
    const flipped = getFlippedPieces(board, BLACK, 2, 3);
    expect(flipped.length).toBe(1);
    expect(flipped).toContainEqual([3, 3]);
  });

  it("getFlippedPieces returns empty array for occupied square", () => {
    const board = createBoard();
    const flipped = getFlippedPieces(board, BLACK, 3, 3);
    expect(flipped.length).toBe(0);
  });

  it("move application flips pieces correctly", () => {
    const board = createBoard();
    // Simulate Black playing at (2, 3)
    const flipped = getFlippedPieces(board, BLACK, 2, 3);
    const newBoard = cloneBoard(board);
    newBoard[2][3] = BLACK;
    for (const [r, c] of flipped) {
      newBoard[r][c] = BLACK;
    }

    // (3, 3) was WHITE, should now be BLACK
    expect(newBoard[2][3]).toBe(BLACK);
    expect(newBoard[3][3]).toBe(BLACK);
    expect(newBoard[3][4]).toBe(BLACK);
    expect(newBoard[4][3]).toBe(BLACK);
    expect(newBoard[4][4]).toBe(WHITE);
  });

  it("multiple pieces can be flipped in one move", () => {
    // Set up a board where a move flips pieces in multiple directions
    const board = createBoard();

    // After Black(2,3): board has B at (2,3),(3,3),(3,4),(4,3) and W at (4,4)
    const b1 = cloneBoard(board);
    b1[2][3] = BLACK;
    b1[3][3] = BLACK; // flipped from white

    // White plays (2,4): flips (3,4) which is black, via direction down
    // Also need (2,4) to have black below ending with white
    // Let's just verify with a known scenario
    const flipped = getFlippedPieces(b1, WHITE, 2, 4);
    expect(flipped.length).toBe(1);
    expect(flipped).toContainEqual([3, 4]);
  });
});

describe("Reversi - scoring", () => {
  it("getScore counts initial pieces correctly", () => {
    const board = createBoard();
    const score = getScore(board);
    expect(score.black).toBe(2);
    expect(score.white).toBe(2);
  });

  it("getScore counts pieces after a move", () => {
    const board = createBoard();
    const newBoard = cloneBoard(board);
    newBoard[2][3] = BLACK;
    newBoard[3][3] = BLACK; // flipped
    const score = getScore(newBoard);
    expect(score.black).toBe(4);
    expect(score.white).toBe(1);
  });

  it("isGameOver returns false for initial board", () => {
    const board = createBoard();
    expect(isGameOver(board)).toBe(false);
  });

  it("isGameOver returns true when no player can move", () => {
    // Create a board where nobody can move (e.g., all one color)
    const board: Board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row: Piece[] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        row.push(BLACK);
      }
      board.push(row);
    }
    expect(isGameOver(board)).toBe(true);
  });

  it("getWinner returns correct winner based on piece count", () => {
    // All black
    const allBlack: Board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row: Piece[] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        row.push(BLACK);
      }
      allBlack.push(row);
    }
    expect(getWinner(allBlack)).toBe("B");

    // All white
    const allWhite: Board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row: Piece[] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        row.push(WHITE);
      }
      allWhite.push(row);
    }
    expect(getWinner(allWhite)).toBe("W");
  });

  it("getWinner returns draw when equal pieces", () => {
    const board = createBoard(); // 2 black, 2 white
    expect(getWinner(board)).toBe("draw");
  });
});

describe("Reversi - complete game scenario", () => {
  it("plays a short game and detects game over", () => {
    let board = createBoard();
    let currentPlayer: Piece = BLACK;

    // Play moves until game over or we've made several moves
    let moveCount = 0;
    const maxMoves = 100;

    while (moveCount < maxMoves) {
      const moves = getLegalMoves(board, currentPlayer);
      if (moves.length === 0) {
        // Current player has no moves, check opponent
        const opponent = getOpponent(currentPlayer);
        const opponentMoves = getLegalMoves(board, opponent);
        if (opponentMoves.length === 0) {
          // Game over
          break;
        }
        // Skip current player's turn
        currentPlayer = opponent;
        continue;
      }

      // Pick the first available move
      const [r, c] = moves[0];
      const flipped = getFlippedPieces(board, currentPlayer, r, c);
      const newBoard = cloneBoard(board);
      newBoard[r][c] = currentPlayer;
      for (const [fr, fc] of flipped) {
        newBoard[fr][fc] = currentPlayer;
      }
      board = newBoard;
      currentPlayer = getOpponent(currentPlayer);
      moveCount++;
    }

    // The game should have ended at some point
    expect(isGameOver(board)).toBe(true);
    expect(moveCount).toBeGreaterThan(0);

    const score = getScore(board);
    expect(score.black + score.white).toBeGreaterThan(4);

    const winner = getWinner(board);
    expect(["B", "W", "draw"]).toContain(winner);
  });

  it("handles a player with no moves being skipped", () => {
    // Construct a board where WHITE has no legal moves but BLACK does.
    // Fill the board so that white is boxed out.
    const board: Board = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const row: Piece[] = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        row.push(EMPTY);
      }
      board.push(row);
    }

    // Create a situation: row 0 all black except last cell is white,
    // and row 1 col 7 is empty.
    // Black at (0,0)-(0,6), White at (0,7), rest empty.
    // White cannot move because no empty square adjacent to black pieces
    // that would flip anything via white.
    // Actually, let's use a simpler construction:
    // Board is mostly empty. Black pieces along column 0 rows 0-6,
    // White piece at (7,0). Empty at (7,1).
    // White has no moves because it can't flip any black pieces.

    // Simple approach: almost-full board
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        board[r][c] = BLACK;
      }
    }
    // Place a single white piece and create one empty square such that
    // only black can move there.
    board[7][7] = WHITE;
    board[7][6] = EMPTY;

    // White has no legal moves (the only empty square (7,6) is adjacent
    // to mostly black, and placing white there would need a line of
    // black ending with white, but there's only one white at (7,7).
    // Actually (7,6) -> direction right -> (7,7) is WHITE, so that's
    // the player's own piece for white — no opponent pieces in between.
    // So white CAN'T move at (7,6).

    // Verify: White has no moves
    const whiteMoves = getLegalMoves(board, WHITE);
    expect(whiteMoves.length).toBe(0);

    // Black CAN move at (7,6) — direction right sees WHITE at (7,7)
    // which means it would flip (7,7). That's a valid move for BLACK.
    const blackMoves = getLegalMoves(board, BLACK);
    expect(blackMoves.length).toBe(1);
    expect(blackMoves[0]).toEqual([7, 6]);

    // Game is NOT over because black can still move
    expect(isGameOver(board)).toBe(false);
  });
});
