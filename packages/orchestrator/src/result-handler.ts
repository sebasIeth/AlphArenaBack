import type { MatchResultReason, PlayerColor, Side } from "@alpharena/shared";
import { PLATFORM_FEE_PERCENT } from "@alpharena/shared";
import { MatchModel, AgentModel } from "@alpharena/db";
import type { IMatch } from "@alpharena/db";
import pino from "pino";

import { getMatch, removeMatch } from "./active-matches.js";
import { eventBus } from "./event-bus.js";

const logger = pino({ name: "orchestrator:result-handler" });

/** ELO K-factor used for rating adjustments. */
const ELO_K = 32;

/**
 * Computes the expected score for a player given their rating
 * and the opponent's rating, using the standard ELO formula.
 */
function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

/**
 * Calculate ELO rating changes for both sides after a match.
 *
 * @param ratingA - Current ELO rating of agent A.
 * @param ratingB - Current ELO rating of agent B.
 * @param outcome - "a" if A won, "b" if B won, "draw" for a draw.
 * @returns Object with the ELO delta for each side (positive = gained, negative = lost).
 */
function calculateEloChanges(
  ratingA: number,
  ratingB: number,
  outcome: "a" | "b" | "draw",
): { a: number; b: number } {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);

  let actualA: number;
  let actualB: number;

  if (outcome === "a") {
    actualA = 1;
    actualB = 0;
  } else if (outcome === "b") {
    actualA = 0;
    actualB = 1;
  } else {
    actualA = 0.5;
    actualB = 0.5;
  }

  const deltaA = Math.round(ELO_K * (actualA - expectedA));
  const deltaB = Math.round(ELO_K * (actualB - expectedB));

  return { a: deltaA, b: deltaB };
}

/**
 * The settlement service interface expected by ResultHandler.
 * This is a lightweight contract so the orchestrator is not tightly
 * coupled to the settlement package's raw functions.
 */
export interface SettlementService {
  payout(matchId: string, winnerAddress: string, amount: bigint): Promise<string | null>;
  refund(matchId: string): Promise<string | null>;
  escrow(matchId: string, agentAAddress: string, agentBAddress: string, stakeAmount: bigint): Promise<string | null>;
}

/**
 * ResultHandler is responsible for finalizing a match after it ends.
 *
 * It determines the winner, triggers settlement (payout or refund),
 * updates the match document and agent statistics/ELO in MongoDB,
 * emits the match:ended event, and removes the match from memory.
 */
export class ResultHandler {
  private readonly settlement: SettlementService;

  constructor(settlement: SettlementService) {
    this.settlement = settlement;
  }

  /**
   * Handle the end of a match.
   *
   * @param matchId - The ID of the match that has ended.
   * @param reason - The reason the match ended.
   * @param forcedWinnerSide - If provided, forces a specific side as the winner
   *                           (used for timeout/forfeit wins).
   */
  async handleMatchEnd(
    matchId: string,
    reason: MatchResultReason,
    forcedWinnerSide?: Side,
  ): Promise<void> {
    const matchState = getMatch(matchId);
    if (!matchState) {
      logger.error({ matchId }, "Match not found in active matches for result handling");
      return;
    }

    // Stop the match clock.
    if (matchState.clock) {
      matchState.clock.stop();
    }

    logger.info(
      { matchId, reason, forcedWinnerSide },
      "Handling match end",
    );

    // Determine the winner.
    const { winnerId, winningSide } = this.determineWinner(
      matchState,
      reason,
      forcedWinnerSide,
    );

    const gameState = matchState.gameState;
    const finalScore = {
      a: gameState.scores.black,
      b: gameState.scores.white,
    };

    // Fetch the match document for ELO calculation.
    const matchDoc = await MatchModel.findById(matchId);
    if (!matchDoc) {
      logger.error({ matchId }, "Match document not found in database");
      removeMatch(matchId);
      return;
    }

    // Calculate ELO changes.
    const eloOutcome: "a" | "b" | "draw" = winningSide ?? "draw";
    const eloChanges = calculateEloChanges(
      matchDoc.agents.a.eloAtStart,
      matchDoc.agents.b.eloAtStart,
      eloOutcome,
    );

    // Perform settlement.
    let payoutTxHash: string | null = null;
    try {
      if (winnerId && winningSide) {
        const potAmount = matchDoc.potAmount;
        const platformFee = Math.floor(potAmount * (PLATFORM_FEE_PERCENT / 100));
        const payoutAmount = potAmount - platformFee;
        payoutTxHash = await this.settlement.payout(matchId, winnerId, BigInt(payoutAmount));
      } else {
        // Draw - refund both parties.
        payoutTxHash = await this.settlement.refund(matchId);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { matchId, error: message },
        "Settlement failed during match end",
      );
      // Continue with result recording even if settlement fails.
      // The settlement can be retried later.
    }

    // Update the match document with the result.
    const matchResult = {
      winnerId: winnerId ?? null,
      reason,
      finalScore,
      totalMoves: gameState.moveNumber,
      eloChange: eloChanges,
    };

    await MatchModel.updateOne(
      { _id: matchId },
      {
        status: "completed",
        result: matchResult,
        currentBoard: gameState.board,
        endedAt: new Date(),
        ...(payoutTxHash ? { "txHashes.payout": payoutTxHash } : {}),
      },
    );

    // Update agent stats and ELO ratings.
    await this.updateAgentStats(
      matchState.agents.a.agentId,
      winningSide === "a" ? "win" : winningSide === "b" ? "loss" : "draw",
      eloChanges.a,
      winningSide === "a" ? this.calculateEarnings(matchDoc) : 0,
    );

    await this.updateAgentStats(
      matchState.agents.b.agentId,
      winningSide === "b" ? "win" : winningSide === "a" ? "loss" : "draw",
      eloChanges.b,
      winningSide === "b" ? this.calculateEarnings(matchDoc) : 0,
    );

    // Emit the match:ended event.
    eventBus.emit("match:ended", {
      matchId,
      result: {
        winnerId,
        reason,
        finalScore,
        totalMoves: gameState.moveNumber,
      },
    });

    logger.info(
      {
        matchId,
        winnerId,
        reason,
        finalScore,
        eloChanges,
        totalMoves: gameState.moveNumber,
      },
      "Match ended successfully",
    );

    // Remove the match from the active matches map.
    removeMatch(matchId);
  }

  /**
   * Determine the winner of a match based on the reason and game state.
   */
  private determineWinner(
    matchState: ReturnType<typeof getMatch> & object,
    reason: MatchResultReason,
    forcedWinnerSide?: Side,
  ): { winnerId: string | null; winningSide: Side | null } {
    // If a winner side is forced (timeout/forfeit), use it.
    if (forcedWinnerSide) {
      return {
        winnerId: matchState.agents[forcedWinnerSide].agentId,
        winningSide: forcedWinnerSide,
      };
    }

    // Determine winner from the game state.
    const { winner } = matchState.gameState;

    if (winner === "draw" || winner === null) {
      // On a draw or undecided state (e.g., match timeout with equal score),
      // check actual piece counts.
      const { scores } = matchState.gameState;
      if (scores.black > scores.white) {
        return {
          winnerId: matchState.agents.a.agentId,
          winningSide: "a",
        };
      } else if (scores.white > scores.black) {
        return {
          winnerId: matchState.agents.b.agentId,
          winningSide: "b",
        };
      }
      // True draw.
      return { winnerId: null, winningSide: null };
    }

    // Map PlayerColor to side.
    const winningSide: Side = winner === "B" ? "a" : "b";
    return {
      winnerId: matchState.agents[winningSide].agentId,
      winningSide,
    };
  }

  /**
   * Calculate the net earnings for the winning agent.
   */
  private calculateEarnings(matchDoc: IMatch): number {
    const potAmount = matchDoc.potAmount;
    const platformFee = Math.floor(potAmount * (PLATFORM_FEE_PERCENT / 100));
    return potAmount - platformFee - matchDoc.stakeAmount;
  }

  /**
   * Update a single agent's stats and ELO rating in MongoDB.
   */
  private async updateAgentStats(
    agentId: string,
    outcome: "win" | "loss" | "draw",
    eloDelta: number,
    earnings: number,
  ): Promise<void> {
    try {
      const statsUpdate: Record<string, number> = {
        "stats.totalMatches": 1,
      };

      if (outcome === "win") {
        statsUpdate["stats.wins"] = 1;
      } else if (outcome === "loss") {
        statsUpdate["stats.losses"] = 1;
      } else {
        statsUpdate["stats.draws"] = 1;
      }

      if (earnings > 0) {
        statsUpdate["stats.totalEarnings"] = earnings;
      }

      await AgentModel.updateOne(
        { _id: agentId },
        {
          $inc: {
            ...statsUpdate,
            eloRating: eloDelta,
          },
          $set: {
            status: "idle",
          },
        },
      );

      // Recalculate win rate after updating stats.
      const agent = await AgentModel.findById(agentId);
      if (agent && agent.stats.totalMatches > 0) {
        const winRate = agent.stats.wins / agent.stats.totalMatches;
        await AgentModel.updateOne(
          { _id: agentId },
          { $set: { "stats.winRate": Math.round(winRate * 10000) / 10000 } },
        );
      }

      logger.info(
        { agentId, outcome, eloDelta, earnings },
        "Agent stats updated",
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        { agentId, error: message },
        "Failed to update agent stats",
      );
    }
  }
}
