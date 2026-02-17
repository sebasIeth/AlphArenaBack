import type {
  GameState,
  PlayerColor,
  Side,
  MoveRequest,
  Position,
} from "@alpharena/shared";
import { GameEngine } from "@alpharena/game-engine";
import { MoveModel, MatchModel } from "@alpharena/db";
import pino from "pino";

import { AgentClient } from "./agent-client.js";
import type { ActiveMatchState } from "./active-matches.js";
import { updateMatch } from "./active-matches.js";
import { eventBus } from "./event-bus.js";

const logger = pino({ name: "orchestrator:turn-controller" });

/**
 * Result of a single turn execution.
 */
export interface TurnResult {
  /** Whether the game has ended after this turn. */
  gameOver: boolean;
  /** Updated game state after the turn. */
  gameState: GameState;
  /** Whether a timeout occurred during this turn. */
  timedOut: boolean;
  /** Whether the current player's turn was passed (no legal moves). */
  passed: boolean;
}

/**
 * Maps a PlayerColor ("B" or "W") to the side ("a" or "b").
 * Agent "a" always plays BLACK, agent "b" always plays WHITE.
 */
function colorToSide(color: PlayerColor): Side {
  return color === "B" ? "a" : "b";
}

/**
 * TurnController handles the logic for executing a single turn within
 * a match. It coordinates between the game engine, the agent client,
 * the match clock, and the database.
 */
export class TurnController {
  private readonly agentClient: AgentClient;

  constructor(agentClient?: AgentClient) {
    this.agentClient = agentClient ?? new AgentClient();
  }

  /**
   * Execute a single turn in the match:
   *
   * 1. Determine which side is playing based on the current game state.
   * 2. Get legal moves from the game engine.
   * 3. Handle pass/end-game if no legal moves are available.
   * 4. Start the turn timer via the MatchClock.
   * 5. Request a move from the agent via the AgentClient.
   * 6. On timeout or invalid move, increment timeout counter.
   * 7. On valid move, apply it and update state.
   * 8. Persist the move to MongoDB.
   * 9. Emit the appropriate events.
   *
   * @param matchState - The current active match state.
   * @param engine - The game engine instance for this match.
   * @returns The result of this turn.
   */
  async executeTurn(
    matchState: ActiveMatchState,
    engine: GameEngine,
  ): Promise<TurnResult> {
    const { matchId, gameState } = matchState;
    const currentColor = gameState.currentPlayer;
    const currentSide = colorToSide(currentColor);
    const agent = matchState.agents[currentSide];

    logger.info(
      {
        matchId,
        moveNumber: gameState.moveNumber,
        currentPlayer: currentColor,
        side: currentSide,
      },
      "Executing turn",
    );

    // Get legal moves for the current player.
    const legalMoves = engine.getLegalMoves(gameState);

    // If the current player has no legal moves, handle pass or game end.
    if (legalMoves.length === 0) {
      return this.handleNoLegalMoves(matchState, engine, currentSide);
    }

    // Start the turn timer.
    let turnDeadline = matchState.turnDeadline;
    if (matchState.clock) {
      turnDeadline = matchState.clock.startTurn();
      updateMatch(matchId, { turnDeadline });
    }

    // Build the move request payload.
    const timeRemainingMs = matchState.clock
      ? matchState.clock.getTimeRemainingMs()
      : 0;

    const moveRequest: MoveRequest = {
      matchId,
      gameType: "reversi",
      board: gameState.board.map((row) => [...row]),
      yourPiece: agent.piece,
      legalMoves,
      moveNumber: gameState.moveNumber,
      timeRemainingMs,
    };

    const thinkingStart = Date.now();

    try {
      // Request a move from the agent.
      const response = await this.agentClient.requestMove(
        agent.endpointUrl,
        moveRequest,
      );

      // Clear the turn timer now that we have a response.
      if (matchState.clock) {
        matchState.clock.clearTurn();
      }

      const thinkingTimeMs = Date.now() - thinkingStart;
      const [row, col] = response.move;

      // Validate the move is among the legal moves.
      const isLegal = legalMoves.some(
        ([lr, lc]) => lr === row && lc === col,
      );

      if (!isLegal) {
        logger.warn(
          { matchId, move: response.move, side: currentSide },
          "Agent returned invalid move, treating as timeout",
        );
        return this.handleTimeout(matchState, currentSide);
      }

      // Apply the move through the game engine.
      const newGameState = engine.applyMove(gameState, { row, col });

      // Compute scores mapped to sides.
      const scoreAfter = {
        a: newGameState.scores.black,
        b: newGameState.scores.white,
      };

      // Update the in-memory match state.
      updateMatch(matchId, { gameState: newGameState });

      // Emit the match:move event.
      eventBus.emit("match:move", {
        matchId,
        side: currentSide,
        move: { row, col },
        boardState: newGameState.board,
        score: scoreAfter,
        moveNumber: newGameState.moveNumber,
        thinkingTimeMs,
      });

      // Persist the move to MongoDB.
      await this.saveMove(
        matchId,
        agent.agentId,
        currentSide,
        newGameState.moveNumber,
        { row, col },
        newGameState.board,
        scoreAfter,
        thinkingTimeMs,
      );

      // Update the match document with the latest board state.
      await MatchModel.updateOne(
        { _id: matchId },
        {
          currentBoard: newGameState.board,
          currentTurn: colorToSide(newGameState.currentPlayer),
          moveCount: newGameState.moveNumber,
        },
      );

      return {
        gameOver: newGameState.gameOver,
        gameState: newGameState,
        timedOut: false,
        passed: false,
      };
    } catch (error: unknown) {
      // Clear the turn timer on error.
      if (matchState.clock) {
        matchState.clock.clearTurn();
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { matchId, side: currentSide, error: message },
        "Error during turn execution, treating as timeout",
      );

      return this.handleTimeout(matchState, currentSide);
    }
  }

  /**
   * Handle the case where the current player has no legal moves.
   * If the opponent has moves, the turn passes. If neither has moves,
   * the game is over.
   */
  private handleNoLegalMoves(
    matchState: ActiveMatchState,
    engine: GameEngine,
    currentSide: Side,
  ): TurnResult {
    const { matchId, gameState } = matchState;

    logger.info(
      { matchId, side: currentSide },
      "Current player has no legal moves",
    );

    // The game engine's applyMove handles pass logic internally.
    // But we need to check if the game is over (neither side can move).
    if (engine.isGameOver(gameState)) {
      logger.info({ matchId }, "Game over - neither player has legal moves");
      return {
        gameOver: true,
        gameState,
        timedOut: false,
        passed: true,
      };
    }

    // The opponent has moves - pass the turn.
    // We need to advance the current player without making a move.
    const opponentColor: PlayerColor = currentSide === "a" ? "W" : "B";
    const passedState: GameState = {
      ...gameState,
      currentPlayer: opponentColor,
    };

    updateMatch(matchId, { gameState: passedState });

    logger.info(
      { matchId, side: currentSide, nextPlayer: opponentColor },
      "Turn passed to opponent",
    );

    return {
      gameOver: false,
      gameState: passedState,
      timedOut: false,
      passed: true,
    };
  }

  /**
   * Handle a timeout (or invalid move treated as timeout).
   * Increments the timeout counter for the given side and emits the event.
   */
  private handleTimeout(
    matchState: ActiveMatchState,
    side: Side,
  ): TurnResult {
    const { matchId, gameState } = matchState;
    const newTimeouts = { ...matchState.timeouts };
    newTimeouts[side] += 1;

    updateMatch(matchId, { timeouts: newTimeouts });

    // Also update timeouts in the database.
    MatchModel.updateOne(
      { _id: matchId },
      { [`timeouts.${side}`]: newTimeouts[side] },
    ).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ matchId, error: msg }, "Failed to update timeout count in DB");
    });

    logger.warn(
      { matchId, side, timeoutCount: newTimeouts[side] },
      "Timeout recorded for agent",
    );

    // Emit the timeout event.
    eventBus.emit("match:timeout", {
      matchId,
      side,
      timeoutCount: newTimeouts[side],
    });

    // Pass the turn to the opponent after a timeout.
    const opponentColor: PlayerColor = side === "a" ? "W" : "B";
    const passedState: GameState = {
      ...gameState,
      currentPlayer: opponentColor,
    };

    updateMatch(matchId, { gameState: passedState });

    return {
      gameOver: false,
      gameState: passedState,
      timedOut: true,
      passed: false,
    };
  }

  /**
   * Persist a move record to MongoDB.
   */
  private async saveMove(
    matchId: string,
    agentId: string,
    side: Side,
    moveNumber: number,
    moveData: { row: number; col: number },
    boardStateAfter: number[][],
    scoreAfter: { a: number; b: number },
    thinkingTimeMs: number,
  ): Promise<void> {
    try {
      await MoveModel.create({
        matchId,
        agentId,
        side,
        moveNumber,
        moveData,
        boardStateAfter,
        scoreAfter,
        thinkingTimeMs,
        timestamp: new Date(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { matchId, moveNumber, error: message },
        "Failed to save move to database",
      );
      // Non-fatal: the game continues even if the move fails to persist.
    }
  }
}
