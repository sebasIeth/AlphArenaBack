import type { GameState, MatchResultReason, Side } from "@alpharena/shared";
import { MAX_TIMEOUTS } from "@alpharena/shared";
import { GameEngine } from "@alpharena/game-engine";
import { MatchModel, AgentModel } from "@alpharena/db";
import pino from "pino";

import { activeMatches, addMatch, getMatch, removeMatch, updateMatch } from "./active-matches.js";
import type { ActiveMatchState } from "./active-matches.js";
import { MatchClock } from "./match-clock.js";
import { TurnController } from "./turn-controller.js";
import { ResultHandler, type SettlementService } from "./result-handler.js";
import { eventBus } from "./event-bus.js";

const logger = pino({ name: "orchestrator:match-manager" });

/**
 * Input describing an agent participating in a match.
 * Contains all the information needed to set up the match without
 * requiring a database lookup.
 */
export interface MatchAgentInput {
  agentId: string;
  userId: string;
  name: string;
  endpointUrl: string;
  eloRating: number;
}

/**
 * MatchManager orchestrates the full lifecycle of a match:
 *
 * 1. **Creation** - Persists the match document and sets up in-memory state.
 * 2. **Starting** - Handles escrow settlement and initiates the game loop.
 * 3. **Game loop** - Alternates turns between agents until the game ends.
 * 4. **Completion** - Delegates to ResultHandler for final settlement, stats, and cleanup.
 *
 * The game loop uses async/await with `setImmediate` between turns to avoid
 * blocking the Node.js event loop.
 */
export class MatchManager {
  private readonly settlement: SettlementService;
  private readonly turnController: TurnController;
  private readonly resultHandler: ResultHandler;

  /** Tracks match IDs that have been ended to prevent double-handling. */
  private readonly endedMatches = new Set<string>();

  constructor(deps: {
    settlementService: SettlementService;
    turnController: TurnController;
    resultHandler: ResultHandler;
  }) {
    this.settlement = deps.settlementService;
    this.turnController = deps.turnController;
    this.resultHandler = deps.resultHandler;
  }

  /**
   * Create a new match between two agents.
   *
   * 1. Creates the Match document in MongoDB.
   * 2. Creates a GameEngine instance and initial game state.
   * 3. Adds the match to the in-memory ActiveMatches map.
   * 4. Sets both agents' status to "in_match".
   * 5. Emits a `match:created` event.
   *
   * @param agentA - The first agent (plays BLACK / side "a").
   * @param agentB - The second agent (plays WHITE / side "b").
   * @param stakeAmount - The amount each agent stakes.
   * @param gameType - The type of game (e.g., "reversi").
   * @returns The newly created match ID.
   */
  async createMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    gameType: string = "reversi",
  ): Promise<string> {
    logger.info(
      {
        agentA: agentA.agentId,
        agentB: agentB.agentId,
        stakeAmount,
        gameType,
      },
      "Creating new match",
    );

    // Create the game engine and initial state.
    const engine = new GameEngine(gameType);
    const initialState = engine.createInitialState();

    // Calculate pot amount (both stakes combined).
    const potAmount = stakeAmount * 2;

    // Create the match document in MongoDB.
    const matchDoc = await MatchModel.create({
      gameType,
      agents: {
        a: {
          agentId: agentA.agentId,
          userId: agentA.userId,
          name: agentA.name,
          eloAtStart: agentA.eloRating,
        },
        b: {
          agentId: agentB.agentId,
          userId: agentB.userId,
          name: agentB.name,
          eloAtStart: agentB.eloRating,
        },
      },
      stakeAmount,
      potAmount,
      status: "starting",
      currentBoard: initialState.board,
      currentTurn: "a",
      moveCount: 0,
      timeouts: { a: 0, b: 0 },
      txHashes: { escrow: null, payout: null },
    });

    const matchId = matchDoc._id.toString();

    // Build the in-memory match state.
    const matchState: ActiveMatchState = {
      matchId,
      gameState: initialState,
      clock: null,
      turnDeadline: 0,
      timeouts: { a: 0, b: 0 },
      status: "starting",
      agents: {
        a: {
          agentId: agentA.agentId,
          endpointUrl: agentA.endpointUrl,
          piece: "B",
        },
        b: {
          agentId: agentB.agentId,
          endpointUrl: agentB.endpointUrl,
          piece: "W",
        },
      },
      startedAt: Date.now(),
    };

    addMatch(matchState);

    // Update agent statuses to "in_match".
    await Promise.all([
      AgentModel.updateOne({ _id: agentA.agentId }, { status: "in_match" }),
      AgentModel.updateOne({ _id: agentB.agentId }, { status: "in_match" }),
    ]);

    // Emit the match:created event.
    eventBus.emit("match:created", {
      matchId,
      agents: {
        a: { agentId: agentA.agentId, name: agentA.name },
        b: { agentId: agentB.agentId, name: agentB.name },
      },
      gameType,
      stakeAmount,
    });

    logger.info({ matchId }, "Match created successfully");

    return matchId;
  }

  /**
   * Start a match that has already been created.
   *
   * 1. Calls settlement to escrow funds.
   * 2. Updates match status to "active".
   * 3. Creates a MatchClock with timeout callbacks.
   * 4. Emits `match:started`.
   * 5. Begins the game loop (non-blocking).
   *
   * If escrow fails, the match is cancelled and agents are reset to idle.
   */
  async startMatch(matchId: string): Promise<void> {
    const matchState = getMatch(matchId);
    if (!matchState) {
      throw new Error(`Cannot start match ${matchId}: not found in active matches.`);
    }

    if (matchState.status !== "starting") {
      throw new Error(
        `Cannot start match ${matchId}: current status is "${matchState.status}", expected "starting".`,
      );
    }

    logger.info({ matchId }, "Starting match");

    // Escrow funds via settlement.
    try {
      const escrowTxHash = await this.settlement.escrow(
        matchId,
        matchState.agents.a.agentId,
        matchState.agents.b.agentId,
        BigInt(0), // Stake amount is already recorded in the match doc.
      );

      await MatchModel.updateOne(
        { _id: matchId },
        { "txHashes.escrow": escrowTxHash },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { matchId, error: message },
        "Escrow failed, cancelling match",
      );

      await MatchModel.updateOne(
        { _id: matchId },
        { status: "cancelled" },
      );

      // Reset agent statuses.
      await Promise.all([
        AgentModel.updateOne({ _id: matchState.agents.a.agentId }, { status: "idle" }),
        AgentModel.updateOne({ _id: matchState.agents.b.agentId }, { status: "idle" }),
      ]);

      eventBus.emit("match:error", {
        matchId,
        error: `Escrow failed: ${message}`,
      });

      removeMatch(matchId);
      return;
    }

    // Create the match clock with timeout callbacks.
    const clock = new MatchClock(matchId, {
      onMatchTimeout: (mId: string) => {
        this.handleMatchTimeout(mId);
      },
      onTurnTimeout: (mId: string) => {
        // Turn timeouts are primarily handled in the TurnController via
        // the AgentClient's AbortController. This callback serves as a
        // safety net for edge cases where the turn timer fires but the
        // HTTP request hasn't yet been aborted.
        logger.warn({ matchId: mId }, "Turn timeout callback fired from clock");
      },
    });

    // Update the match state to active.
    updateMatch(matchId, {
      status: "active",
      clock,
      startedAt: Date.now(),
    });

    // Update the database status.
    await MatchModel.updateOne(
      { _id: matchId },
      { status: "active", startedAt: new Date() },
    );

    // Start the match clock.
    clock.startMatch();

    // Emit the match:started event.
    eventBus.emit("match:started", {
      matchId,
      gameType: "reversi",
      board: matchState.gameState.board,
    });

    logger.info({ matchId }, "Match started, beginning game loop");

    // Run the game loop asynchronously (non-blocking).
    this.runGameLoop(matchId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, error: message }, "Game loop failed unexpectedly");
      this.endMatchWithError(matchId, message);
    });
  }

  /**
   * Run the game loop for a match.
   *
   * Continuously executes turns until:
   * - The game is over (natural end via scoring).
   * - A side exceeds the maximum timeout count.
   * - The match timer expires (handled via MatchClock callback).
   * - An unrecoverable error occurs.
   *
   * Uses `setImmediate` between turns to yield to the event loop and avoid
   * blocking other I/O operations.
   */
  async runGameLoop(matchId: string): Promise<void> {
    const engine = new GameEngine("reversi");

    while (true) {
      // Re-fetch the match state at the top of each iteration because it
      // may have been updated by timeout callbacks or other async handlers.
      const matchState = getMatch(matchId);
      if (!matchState) {
        logger.info({ matchId }, "Match removed from active matches, stopping game loop");
        return;
      }

      if (matchState.status !== "active") {
        logger.info(
          { matchId, status: matchState.status },
          "Match is no longer active, stopping game loop",
        );
        return;
      }

      // Check if the game is already over before executing a turn.
      if (engine.isGameOver(matchState.gameState)) {
        logger.info({ matchId }, "Game is over, finalizing result");
        const reason = matchState.gameState.winner === "draw" ? "draw" : "score";
        await this.endMatch(matchId, reason);
        return;
      }

      // Check if either side has already exceeded the maximum timeout count.
      if (matchState.timeouts.a >= MAX_TIMEOUTS) {
        logger.info(
          { matchId, side: "a", timeouts: matchState.timeouts.a },
          "Agent A exceeded max timeouts, agent B wins",
        );
        await this.endMatch(matchId, "timeout", "b");
        return;
      }
      if (matchState.timeouts.b >= MAX_TIMEOUTS) {
        logger.info(
          { matchId, side: "b", timeouts: matchState.timeouts.b },
          "Agent B exceeded max timeouts, agent A wins",
        );
        await this.endMatch(matchId, "timeout", "a");
        return;
      }

      // Execute the turn.
      const turnResult = await this.turnController.executeTurn(matchState, engine);

      // Re-check the match state after the turn (it may have been ended
      // by a timeout handler while the turn was executing).
      const updatedState = getMatch(matchId);
      if (!updatedState) {
        logger.info({ matchId }, "Match removed during turn execution");
        return;
      }

      // Check if the game ended during this turn.
      if (turnResult.gameOver) {
        logger.info({ matchId }, "Game ended during turn execution");
        const reason = turnResult.gameState.winner === "draw" ? "draw" : "score";
        await this.endMatch(matchId, reason);
        return;
      }

      // Check for max timeouts after this turn.
      if (updatedState.timeouts.a >= MAX_TIMEOUTS) {
        logger.info(
          { matchId, side: "a", timeouts: updatedState.timeouts.a },
          "Agent A exceeded max timeouts after turn, agent B wins",
        );
        await this.endMatch(matchId, "timeout", "b");
        return;
      }
      if (updatedState.timeouts.b >= MAX_TIMEOUTS) {
        logger.info(
          { matchId, side: "b", timeouts: updatedState.timeouts.b },
          "Agent B exceeded max timeouts after turn, agent A wins",
        );
        await this.endMatch(matchId, "timeout", "a");
        return;
      }

      // Yield to the event loop before processing the next turn.
      // This prevents the game loop from monopolizing the thread.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * End a match with a given reason and optional forced winner.
   * Guards against being called multiple times for the same match
   * (e.g., by both the game loop and a timer callback).
   */
  private async endMatch(
    matchId: string,
    reason: MatchResultReason,
    forcedWinnerSide?: Side,
  ): Promise<void> {
    // Prevent double-ending.
    if (this.endedMatches.has(matchId)) {
      logger.debug({ matchId }, "Match already ended, skipping duplicate end call");
      return;
    }
    this.endedMatches.add(matchId);

    try {
      await this.resultHandler.handleMatchEnd(matchId, reason, forcedWinnerSide);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, error: message }, "Error during match end handling");
    } finally {
      // Clean up the ended-match guard after a delay to allow any
      // in-flight callbacks to be deduplicated.
      setTimeout(() => {
        this.endedMatches.delete(matchId);
      }, 5000);
    }
  }

  /**
   * Handle the match-level timeout (overall match duration expired).
   * The side with more pieces wins. On a tie, it's a draw.
   */
  private handleMatchTimeout(matchId: string): void {
    logger.warn({ matchId }, "Match timer expired, determining winner by score");

    const matchState = getMatch(matchId);
    if (!matchState) {
      return;
    }

    const { scores } = matchState.gameState;
    let forcedWinner: Side | undefined;

    if (scores.black > scores.white) {
      forcedWinner = "a";
    } else if (scores.white > scores.black) {
      forcedWinner = "b";
    }
    // If scores are equal, no forced winner (draw).

    this.endMatch(matchId, "timeout", forcedWinner).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, error: message }, "Failed to end match after timeout");
    });
  }

  /**
   * End a match due to an unrecoverable error.
   * Attempts to refund both parties and resets agent statuses.
   */
  private async endMatchWithError(matchId: string, errorMessage: string): Promise<void> {
    // Prevent double-ending on error path as well.
    if (this.endedMatches.has(matchId)) {
      return;
    }
    this.endedMatches.add(matchId);

    const matchState = getMatch(matchId);
    if (matchState?.clock) {
      matchState.clock.stop();
    }

    eventBus.emit("match:error", { matchId, error: errorMessage });

    try {
      await MatchModel.updateOne(
        { _id: matchId },
        {
          status: "error",
          endedAt: new Date(),
        },
      );

      // Attempt to refund both parties.
      try {
        await this.settlement.refund(matchId);
      } catch (refundError: unknown) {
        const msg = refundError instanceof Error ? refundError.message : String(refundError);
        logger.error({ matchId, error: msg }, "Refund failed during error recovery");
      }

      // Reset agent statuses to idle.
      if (matchState) {
        await Promise.all([
          AgentModel.updateOne({ _id: matchState.agents.a.agentId }, { status: "idle" }),
          AgentModel.updateOne({ _id: matchState.agents.b.agentId }, { status: "idle" }),
        ]);
      }
    } catch (dbError: unknown) {
      const msg = dbError instanceof Error ? dbError.message : String(dbError);
      logger.error({ matchId, error: msg }, "Failed to update match status to error");
    }

    removeMatch(matchId);

    setTimeout(() => {
      this.endedMatches.delete(matchId);
    }, 5000);
  }

  /**
   * Stop all active matches managed by this MatchManager.
   * Used during graceful shutdown. Each match clock is stopped, and
   * the match is ended with a "forfeit" reason.
   */
  async stopAll(): Promise<void> {
    const matchIds = [...activeMatches.keys()];

    logger.info(
      { count: matchIds.length },
      "Stopping all active matches",
    );

    for (const matchId of matchIds) {
      try {
        const matchState = getMatch(matchId);
        if (matchState?.clock) {
          matchState.clock.stop();
        }
        await this.endMatch(matchId, "forfeit");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ matchId, error: message }, "Error stopping match during shutdown");
      }
    }
  }
}
