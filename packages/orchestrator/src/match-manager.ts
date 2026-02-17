import type { GameState, MatchResultReason, Side, MarrakechGameState } from "@alpharena/shared";
import { MAX_TIMEOUTS } from "@alpharena/shared";
import { GameEngine, marrakech } from "@alpharena/game-engine";
import { MatchModel, AgentModel } from "@alpharena/db";
import pino from "pino";

import { activeMatches, addMatch, getMatch, removeMatch, updateMatch } from "./active-matches.js";
import type { ActiveMatchState } from "./active-matches.js";
import { MatchClock } from "./match-clock.js";
import { TurnController } from "./turn-controller.js";
import { MarrakechTurnController } from "./marrakech-turn-controller.js";
import { ResultHandler, type SettlementService } from "./result-handler.js";
import { eventBus } from "./event-bus.js";

const logger = pino({ name: "orchestrator:match-manager" });

/**
 * Input describing an agent participating in a match.
 */
export interface MatchAgentInput {
  agentId: string;
  userId: string;
  name: string;
  endpointUrl: string;
  eloRating: number;
}

/**
 * MatchManager orchestrates the full lifecycle of a match.
 * Supports both Reversi and Marrakech game types.
 */
export class MatchManager {
  private readonly settlement: SettlementService;
  private readonly turnController: TurnController;
  private readonly marrakechTurnController: MarrakechTurnController;
  private readonly resultHandler: ResultHandler;

  /** Tracks match IDs that have been ended to prevent double-handling. */
  private readonly endedMatches = new Set<string>();

  /** Stores Marrakech game state for active matches. */
  private readonly marrakechStates = new Map<string, MarrakechGameState>();

  /** Stores game type for active matches. */
  private readonly matchGameTypes = new Map<string, string>();

  constructor(deps: {
    settlementService: SettlementService;
    turnController: TurnController;
    resultHandler: ResultHandler;
  }) {
    this.settlement = deps.settlementService;
    this.turnController = deps.turnController;
    this.resultHandler = deps.resultHandler;
    this.marrakechTurnController = new MarrakechTurnController();
  }

  /**
   * Create a new match between two agents.
   */
  async createMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    gameType: string = "reversi",
  ): Promise<string> {
    logger.info(
      { agentA: agentA.agentId, agentB: agentB.agentId, stakeAmount, gameType },
      "Creating new match",
    );

    const potAmount = stakeAmount * 2;
    let initialBoard: number[][];

    if (gameType === "marrakech") {
      // Create Marrakech initial state
      const mkState = marrakech.createInitialState(2, [agentA.name, agentB.name]);
      // Serialize board for DB
      initialBoard = mkState.board.map((row) =>
        row.map((cell) => (cell ? cell.playerId + 1 : 0)),
      );

      // Store the Marrakech state temporarily (will be associated with matchId after creation)
      const matchDoc = await MatchModel.create({
        gameType,
        agents: {
          a: { agentId: agentA.agentId, userId: agentA.userId, name: agentA.name, eloAtStart: agentA.eloRating },
          b: { agentId: agentB.agentId, userId: agentB.userId, name: agentB.name, eloAtStart: agentB.eloRating },
        },
        stakeAmount,
        potAmount,
        status: "starting",
        currentBoard: initialBoard,
        currentTurn: "a",
        moveCount: 0,
        timeouts: { a: 0, b: 0 },
        txHashes: { escrow: null, payout: null },
      });

      const matchId = matchDoc._id.toString();

      // Create a minimal GameState for compatibility with ActiveMatchState
      const compatState: GameState = {
        board: initialBoard,
        currentPlayer: "B",
        moveNumber: 0,
        scores: { black: mkState.players[0].dirhams, white: mkState.players[1].dirhams },
        gameOver: false,
        winner: null,
      };

      const matchState: ActiveMatchState = {
        matchId,
        gameState: compatState,
        clock: null,
        turnDeadline: 0,
        timeouts: { a: 0, b: 0 },
        status: "starting",
        agents: {
          a: { agentId: agentA.agentId, endpointUrl: agentA.endpointUrl, piece: "B" },
          b: { agentId: agentB.agentId, endpointUrl: agentB.endpointUrl, piece: "W" },
        },
        startedAt: Date.now(),
      };

      addMatch(matchState);
      this.marrakechStates.set(matchId, mkState);
      this.matchGameTypes.set(matchId, "marrakech");

      await Promise.all([
        AgentModel.updateOne({ _id: agentA.agentId }, { status: "in_match" }),
        AgentModel.updateOne({ _id: agentB.agentId }, { status: "in_match" }),
      ]);

      eventBus.emit("match:created", {
        matchId,
        agents: {
          a: { agentId: agentA.agentId, name: agentA.name },
          b: { agentId: agentB.agentId, name: agentB.name },
        },
        gameType,
        stakeAmount,
      });

      logger.info({ matchId, gameType }, "Marrakech match created successfully");
      return matchId;
    }

    // Default: Reversi
    const engine = new GameEngine(gameType);
    const initialState = engine.createInitialState();
    initialBoard = initialState.board;

    const matchDoc = await MatchModel.create({
      gameType,
      agents: {
        a: { agentId: agentA.agentId, userId: agentA.userId, name: agentA.name, eloAtStart: agentA.eloRating },
        b: { agentId: agentB.agentId, userId: agentB.userId, name: agentB.name, eloAtStart: agentB.eloRating },
      },
      stakeAmount,
      potAmount,
      status: "starting",
      currentBoard: initialBoard,
      currentTurn: "a",
      moveCount: 0,
      timeouts: { a: 0, b: 0 },
      txHashes: { escrow: null, payout: null },
    });

    const matchId = matchDoc._id.toString();

    const matchState: ActiveMatchState = {
      matchId,
      gameState: initialState,
      clock: null,
      turnDeadline: 0,
      timeouts: { a: 0, b: 0 },
      status: "starting",
      agents: {
        a: { agentId: agentA.agentId, endpointUrl: agentA.endpointUrl, piece: "B" },
        b: { agentId: agentB.agentId, endpointUrl: agentB.endpointUrl, piece: "W" },
      },
      startedAt: Date.now(),
    };

    addMatch(matchState);
    this.matchGameTypes.set(matchId, "reversi");

    await Promise.all([
      AgentModel.updateOne({ _id: agentA.agentId }, { status: "in_match" }),
      AgentModel.updateOne({ _id: agentB.agentId }, { status: "in_match" }),
    ]);

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

    const gameType = this.matchGameTypes.get(matchId) ?? "reversi";
    logger.info({ matchId, gameType }, "Starting match");

    // Escrow funds via settlement.
    try {
      const escrowTxHash = await this.settlement.escrow(
        matchId,
        matchState.agents.a.agentId,
        matchState.agents.b.agentId,
        BigInt(0),
      );

      await MatchModel.updateOne(
        { _id: matchId },
        { "txHashes.escrow": escrowTxHash },
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, error: message }, "Escrow failed, cancelling match");

      await MatchModel.updateOne({ _id: matchId }, { status: "cancelled" });

      await Promise.all([
        AgentModel.updateOne({ _id: matchState.agents.a.agentId }, { status: "idle" }),
        AgentModel.updateOne({ _id: matchState.agents.b.agentId }, { status: "idle" }),
      ]);

      eventBus.emit("match:error", { matchId, error: `Escrow failed: ${message}` });
      removeMatch(matchId);
      this.marrakechStates.delete(matchId);
      this.matchGameTypes.delete(matchId);
      return;
    }

    // Create the match clock.
    const clock = new MatchClock(matchId, {
      onMatchTimeout: (mId: string) => { this.handleMatchTimeout(mId); },
      onTurnTimeout: (mId: string) => {
        logger.warn({ matchId: mId }, "Turn timeout callback fired from clock");
      },
    });

    updateMatch(matchId, { status: "active", clock, startedAt: Date.now() });

    await MatchModel.updateOne(
      { _id: matchId },
      { status: "active", startedAt: new Date() },
    );

    clock.startMatch();

    eventBus.emit("match:started", {
      matchId,
      gameType,
      board: matchState.gameState.board,
    });

    logger.info({ matchId, gameType }, "Match started, beginning game loop");

    // Run the appropriate game loop
    const loopFn = gameType === "marrakech"
      ? this.runMarrakechGameLoop(matchId)
      : this.runGameLoop(matchId);

    loopFn.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, error: message }, "Game loop failed unexpectedly");
      this.endMatchWithError(matchId, message);
    });
  }

  /**
   * Run the Reversi game loop.
   */
  async runGameLoop(matchId: string): Promise<void> {
    const engine = new GameEngine("reversi");

    while (true) {
      const matchState = getMatch(matchId);
      if (!matchState) {
        logger.info({ matchId }, "Match removed from active matches, stopping game loop");
        return;
      }
      if (matchState.status !== "active") {
        logger.info({ matchId, status: matchState.status }, "Match is no longer active, stopping game loop");
        return;
      }
      if (engine.isGameOver(matchState.gameState)) {
        const reason = matchState.gameState.winner === "draw" ? "draw" : "score";
        await this.endMatch(matchId, reason);
        return;
      }
      if (matchState.timeouts.a >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "b");
        return;
      }
      if (matchState.timeouts.b >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "a");
        return;
      }

      const turnResult = await this.turnController.executeTurn(matchState, engine);

      const updatedState = getMatch(matchId);
      if (!updatedState) return;

      if (turnResult.gameOver) {
        const reason = turnResult.gameState.winner === "draw" ? "draw" : "score";
        await this.endMatch(matchId, reason);
        return;
      }
      if (updatedState.timeouts.a >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "b");
        return;
      }
      if (updatedState.timeouts.b >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "a");
        return;
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * Run the Marrakech game loop.
   * Handles multi-phase turns: orient → roll → [borderChoice] → tribute → place
   */
  async runMarrakechGameLoop(matchId: string): Promise<void> {
    while (true) {
      const matchState = getMatch(matchId);
      if (!matchState) {
        logger.info({ matchId }, "Match removed, stopping Marrakech game loop");
        return;
      }
      if (matchState.status !== "active") {
        logger.info({ matchId, status: matchState.status }, "Match no longer active");
        return;
      }

      let mkState = this.marrakechStates.get(matchId);
      if (!mkState) {
        logger.error({ matchId }, "Marrakech state not found");
        await this.endMatchWithError(matchId, "Marrakech state lost");
        return;
      }

      if (mkState.gameOver) {
        logger.info({ matchId }, "Marrakech game over");
        // Determine winner
        const winnerId = mkState.winner;
        let winningSide: Side | undefined;
        if (winnerId === 0) winningSide = "a";
        else if (winnerId === 1) winningSide = "b";
        // Update game state scores for result handler
        updateMatch(matchId, {
          gameState: {
            ...matchState.gameState,
            scores: {
              black: mkState.players[0]?.dirhams ?? 0,
              white: mkState.players[1]?.dirhams ?? 0,
            },
            gameOver: true,
            winner: winningSide === "a" ? "B" : winningSide === "b" ? "W" : "draw",
          },
        });
        await this.endMatch(matchId, "score", winningSide);
        return;
      }

      // Check timeouts
      if (matchState.timeouts.a >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "b");
        return;
      }
      if (matchState.timeouts.b >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "a");
        return;
      }

      // Execute one full Marrakech turn
      const turnResult = await this.marrakechTurnController.executeTurn(matchState, mkState);

      // Update stored state
      this.marrakechStates.set(matchId, turnResult.gameState);

      // Update compat game state
      updateMatch(matchId, {
        gameState: {
          ...matchState.gameState,
          scores: {
            black: turnResult.gameState.players[0]?.dirhams ?? 0,
            white: turnResult.gameState.players[1]?.dirhams ?? 0,
          },
          moveNumber: turnResult.gameState.turnNumber,
          gameOver: turnResult.gameState.gameOver,
          winner: turnResult.gameState.winner === 0
            ? "B"
            : turnResult.gameState.winner === 1
            ? "W"
            : turnResult.gameState.gameOver ? "draw" : null,
        },
      });

      // Re-check after turn
      const updated = getMatch(matchId);
      if (!updated) return;

      if (turnResult.gameOver) {
        const winnerId = turnResult.gameState.winner;
        let winningSide: Side | undefined;
        if (winnerId === 0) winningSide = "a";
        else if (winnerId === 1) winningSide = "b";
        await this.endMatch(matchId, "score", winningSide);
        return;
      }

      if (updated.timeouts.a >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "b");
        return;
      }
      if (updated.timeouts.b >= MAX_TIMEOUTS) {
        await this.endMatch(matchId, "timeout", "a");
        return;
      }

      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /**
   * End a match with a given reason and optional forced winner.
   */
  private async endMatch(
    matchId: string,
    reason: MatchResultReason,
    forcedWinnerSide?: Side,
  ): Promise<void> {
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
      // Clean up Marrakech state
      this.marrakechStates.delete(matchId);
      this.matchGameTypes.delete(matchId);

      setTimeout(() => {
        this.endedMatches.delete(matchId);
      }, 5000);
    }
  }

  /**
   * Handle the match-level timeout.
   */
  private handleMatchTimeout(matchId: string): void {
    logger.warn({ matchId }, "Match timer expired, determining winner by score");

    const matchState = getMatch(matchId);
    if (!matchState) return;

    const gameType = this.matchGameTypes.get(matchId) ?? "reversi";

    let forcedWinner: Side | undefined;

    if (gameType === "marrakech") {
      const mkState = this.marrakechStates.get(matchId);
      if (mkState) {
        const scores = marrakech.calculateFinalScores(mkState);
        if (scores.length >= 2) {
          if (scores[0].total > scores[1].total) {
            forcedWinner = scores[0].playerId === 0 ? "a" : "b";
          }
        }
      }
    } else {
      const { scores } = matchState.gameState;
      if (scores.black > scores.white) forcedWinner = "a";
      else if (scores.white > scores.black) forcedWinner = "b";
    }

    this.endMatch(matchId, "timeout", forcedWinner).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ matchId, error: message }, "Failed to end match after timeout");
    });
  }

  /**
   * End a match due to an unrecoverable error.
   */
  private async endMatchWithError(matchId: string, errorMessage: string): Promise<void> {
    if (this.endedMatches.has(matchId)) return;
    this.endedMatches.add(matchId);

    const matchState = getMatch(matchId);
    if (matchState?.clock) matchState.clock.stop();

    eventBus.emit("match:error", { matchId, error: errorMessage });

    try {
      await MatchModel.updateOne(
        { _id: matchId },
        { status: "error", endedAt: new Date() },
      );

      try {
        await this.settlement.refund(matchId);
      } catch (refundError: unknown) {
        const msg = refundError instanceof Error ? refundError.message : String(refundError);
        logger.error({ matchId, error: msg }, "Refund failed during error recovery");
      }

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
    this.marrakechStates.delete(matchId);
    this.matchGameTypes.delete(matchId);

    setTimeout(() => {
      this.endedMatches.delete(matchId);
    }, 5000);
  }

  /**
   * Stop all active matches managed by this MatchManager.
   */
  async stopAll(): Promise<void> {
    const matchIds = [...activeMatches.keys()];
    logger.info({ count: matchIds.length }, "Stopping all active matches");

    for (const matchId of matchIds) {
      try {
        const matchState = getMatch(matchId);
        if (matchState?.clock) matchState.clock.stop();
        await this.endMatch(matchId, "forfeit");
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ matchId, error: message }, "Error stopping match during shutdown");
      }
    }
  }

  /**
   * Get the Marrakech game state for a match (for API/WebSocket use).
   */
  getMarrakechState(matchId: string): MarrakechGameState | undefined {
    return this.marrakechStates.get(matchId);
  }

  getGameType(matchId: string): string {
    return this.matchGameTypes.get(matchId) ?? "reversi";
  }
}
