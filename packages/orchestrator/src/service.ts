import pino from "pino";
import { MatchManager, type MatchAgentInput } from "./match-manager.js";
import { TurnController } from "./turn-controller.js";
import { ResultHandler, type SettlementService } from "./result-handler.js";
import { activeMatches, getMatch } from "./active-matches.js";
import type { ActiveMatchState } from "./active-matches.js";
import { eventBus } from "./event-bus.js";

const logger = pino({ name: "orchestrator:service" });

/**
 * OrchestratorService is the top-level facade that composes all the
 * orchestrator sub-components (MatchManager, TurnController, ResultHandler)
 * and exposes a clean API for the rest of the application.
 *
 * External consumers (e.g., the API layer, matchmaking service) interact
 * with matches exclusively through this service.
 */
export class OrchestratorService {
  private readonly matchManager: MatchManager;
  private readonly turnController: TurnController;
  private readonly resultHandler: ResultHandler;
  private readonly settlement: SettlementService;
  private running = false;

  constructor(settlement: SettlementService) {
    this.settlement = settlement;
    this.turnController = new TurnController();
    this.resultHandler = new ResultHandler(settlement);
    this.matchManager = new MatchManager({
      settlementService: settlement,
      turnController: this.turnController,
      resultHandler: this.resultHandler,
    });
  }

  /**
   * Initialize the orchestrator service.
   * Sets up any listeners and marks the service as running.
   */
  start(): void {
    if (this.running) {
      logger.warn("OrchestratorService is already running");
      return;
    }

    this.running = true;
    logger.info("OrchestratorService started");
  }

  /**
   * Gracefully stop the orchestrator service.
   * Stops all active matches (ending them as forfeits), clears timers,
   * and removes all event listeners from the event bus.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      logger.warn("OrchestratorService is not running");
      return;
    }

    logger.info(
      { activeMatchCount: activeMatches.size },
      "Stopping OrchestratorService",
    );

    // Stop all active matches via the MatchManager.
    await this.matchManager.stopAll();

    // Clear any remaining matches that weren't cleaned up.
    for (const [matchId, matchState] of activeMatches) {
      if (matchState.clock) {
        matchState.clock.stop();
      }
      logger.info({ matchId }, "Force-stopped remaining active match on shutdown");
    }
    activeMatches.clear();

    // Remove all event listeners to prevent memory leaks.
    eventBus.removeAllListeners();

    this.running = false;
    logger.info("OrchestratorService stopped");
  }

  /**
   * Create and start a new match between two agents.
   *
   * This is a convenience method that handles both the creation and
   * starting phases of a match. The game loop begins running
   * asynchronously after this method returns.
   *
   * @param agentA - First agent input (will play BLACK / side "a").
   * @param agentB - Second agent input (will play WHITE / side "b").
   * @param stakeAmount - Amount each agent stakes for the match.
   * @param gameType - The game type to play (defaults to "reversi").
   * @returns The ID of the newly created and started match.
   */
  async startMatch(
    agentA: MatchAgentInput,
    agentB: MatchAgentInput,
    stakeAmount: number,
    gameType: string = "reversi",
  ): Promise<string> {
    if (!this.running) {
      throw new Error("OrchestratorService is not running. Call start() first.");
    }

    const matchId = await this.matchManager.createMatch(
      agentA,
      agentB,
      stakeAmount,
      gameType,
    );

    await this.matchManager.startMatch(matchId);

    return matchId;
  }

  /**
   * Retrieve the in-memory state of an active match.
   *
   * @param matchId - The match ID to look up.
   * @returns The active match state, or `undefined` if not found.
   */
  getActiveMatch(matchId: string): ActiveMatchState | undefined {
    return getMatch(matchId);
  }

  /**
   * Get the number of currently active matches.
   */
  getActiveMatchCount(): number {
    return activeMatches.size;
  }
}
