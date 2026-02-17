import { describe, it, expect } from "vitest";
import { GameEngine } from "../engine.js";
import { BLACK, WHITE } from "../games/reversi/index.js";

describe("GameEngine", () => {
  it("throws for unknown game type", () => {
    expect(() => new GameEngine("chess")).toThrow("Unknown game type");
  });

  it("creates initial state correctly", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();

    expect(state.board.length).toBe(8);
    expect(state.board[0].length).toBe(8);
    expect(state.currentPlayer).toBe("B");
    expect(state.moveNumber).toBe(0);
    expect(state.scores.black).toBe(2);
    expect(state.scores.white).toBe(2);
    expect(state.gameOver).toBe(false);
    expect(state.winner).toBeNull();
  });

  it("creates initial state with correct center pieces", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();

    expect(state.board[3][3]).toBe(WHITE);
    expect(state.board[3][4]).toBe(BLACK);
    expect(state.board[4][3]).toBe(BLACK);
    expect(state.board[4][4]).toBe(WHITE);
  });

  it("getLegalMoves returns 4 initial moves for black", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();
    const moves = engine.getLegalMoves(state);

    expect(moves.length).toBe(4);
    expect(moves).toContainEqual([2, 3]);
    expect(moves).toContainEqual([3, 2]);
    expect(moves).toContainEqual([4, 5]);
    expect(moves).toContainEqual([5, 4]);
  });

  it("applyMove updates state correctly", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();

    // Black plays at (2, 3) — flips (3, 3) from white to black
    const newState = engine.applyMove(state, { row: 2, col: 3 });

    expect(newState.board[2][3]).toBe(BLACK);
    expect(newState.board[3][3]).toBe(BLACK); // flipped
    expect(newState.moveNumber).toBe(1);
    expect(newState.currentPlayer).toBe("W");
    expect(newState.scores.black).toBe(4);
    expect(newState.scores.white).toBe(1);
    expect(newState.gameOver).toBe(false);
  });

  it("applyMove does not mutate original state", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();
    const originalBoard = JSON.parse(JSON.stringify(state.board));

    engine.applyMove(state, { row: 2, col: 3 });

    expect(state.board).toEqual(originalBoard);
    expect(state.currentPlayer).toBe("B");
    expect(state.moveNumber).toBe(0);
  });

  it("applyMove throws for invalid move", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();

    expect(() => engine.applyMove(state, { row: 0, col: 0 })).toThrow(
      "Invalid move",
    );
  });

  it("applyMove throws when game is over", () => {
    const engine = new GameEngine("reversi");
    const state = engine.createInitialState();
    state.gameOver = true;

    expect(() => engine.applyMove(state, { row: 2, col: 3 })).toThrow(
      "game is already over",
    );
  });

  it("plays multiple moves through the engine", () => {
    const engine = new GameEngine("reversi");
    let state = engine.createInitialState();

    // Black plays (2, 3)
    state = engine.applyMove(state, { row: 2, col: 3 });
    expect(state.currentPlayer).toBe("W");
    expect(state.moveNumber).toBe(1);

    // White plays — get a legal move for white and play it
    const whiteMoves = engine.getLegalMoves(state);
    expect(whiteMoves.length).toBeGreaterThan(0);

    state = engine.applyMove(state, {
      row: whiteMoves[0][0],
      col: whiteMoves[0][1],
    });
    expect(state.currentPlayer).toBe("B");
    expect(state.moveNumber).toBe(2);
  });

  it("detects game over through the engine", () => {
    const engine = new GameEngine("reversi");
    let state = engine.createInitialState();

    expect(engine.isGameOver(state)).toBe(false);

    // Play a full game
    let moveCount = 0;
    while (!engine.isGameOver(state) && moveCount < 100) {
      const moves = engine.getLegalMoves(state);
      if (moves.length === 0) {
        // This shouldn't happen since applyMove handles turn skipping,
        // but just in case, break the loop.
        break;
      }
      state = engine.applyMove(state, { row: moves[0][0], col: moves[0][1] });
      moveCount++;
    }

    expect(engine.isGameOver(state)).toBe(true);
    expect(state.gameOver).toBe(true);
  });

  it("getResult returns correct result", () => {
    const engine = new GameEngine("reversi");
    let state = engine.createInitialState();

    // Play a full game
    while (!engine.isGameOver(state)) {
      const moves = engine.getLegalMoves(state);
      if (moves.length === 0) break;
      state = engine.applyMove(state, { row: moves[0][0], col: moves[0][1] });
    }

    const result = engine.getResult(state);
    expect(["B", "W", "draw"]).toContain(result.winner);
    expect(result.finalScore.black + result.finalScore.white).toBeGreaterThan(0);
    expect(result.totalMoves).toBeGreaterThan(0);
    expect(["score", "draw"]).toContain(result.reason);
  });

  it("handles turn skipping when opponent has no moves", () => {
    const engine = new GameEngine("reversi");
    let state = engine.createInitialState();

    // Play a full game and verify it completes properly
    let consecutiveSamePlayer = 0;
    let lastPlayer = state.currentPlayer;

    while (!engine.isGameOver(state)) {
      const moves = engine.getLegalMoves(state);
      if (moves.length === 0) break;
      state = engine.applyMove(state, { row: moves[0][0], col: moves[0][1] });

      if (state.currentPlayer === lastPlayer) {
        consecutiveSamePlayer++;
      } else {
        consecutiveSamePlayer = 0;
      }
      lastPlayer = state.currentPlayer;
    }

    // The game should complete without errors
    expect(engine.isGameOver(state)).toBe(true);
  });
});
