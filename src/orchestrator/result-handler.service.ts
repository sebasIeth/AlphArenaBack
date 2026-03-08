import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PLATFORM_FEE_PERCENT, TOKEN_DECIMALS } from '../common/constants/game.constants';
import { MatchResultReason, Side } from '../common/types';
import { Match, Agent } from '../database/schemas';
import { ActiveMatchesService, ActiveMatchState } from './active-matches.service';
import { EventBusService } from './event-bus.service';
import { SettlementService } from '../settlement/settlement.service';

const ELO_K = 32;

function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function calculateEloChanges(
  ratingA: number,
  ratingB: number,
  outcome: 'a' | 'b' | 'draw',
): { a: number; b: number } {
  const expectedA = expectedScore(ratingA, ratingB);
  const expectedB = expectedScore(ratingB, ratingA);
  let actualA: number, actualB: number;

  if (outcome === 'a') { actualA = 1; actualB = 0; }
  else if (outcome === 'b') { actualA = 0; actualB = 1; }
  else { actualA = 0.5; actualB = 0.5; }

  return {
    a: Math.round(ELO_K * (actualA - expectedA)),
    b: Math.round(ELO_K * (actualB - expectedB)),
  };
}

/**
 * For N-player poker, calculate ELO changes using average pairwise results.
 * Winner(s) get a positive average, losers get a negative average.
 */
function calculatePokerEloChanges(
  players: { agentId: string; eloAtStart: number }[],
  winnerAgentId: string | null,
): Record<string, number> {
  const changes: Record<string, number> = {};
  for (const p of players) changes[p.agentId] = 0;

  if (players.length < 2) return changes;

  // Pairwise ELO: each player is compared against each other
  for (let i = 0; i < players.length; i++) {
    let totalDelta = 0;
    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const expected = expectedScore(players[i].eloAtStart, players[j].eloAtStart);
      let actual: number;
      if (winnerAgentId === players[i].agentId) actual = 1;
      else if (winnerAgentId === players[j].agentId) actual = 0;
      else actual = 0.5; // both are losers → draw between them
      totalDelta += ELO_K * (actual - expected);
    }
    // Average over pairwise comparisons
    changes[players[i].agentId] = Math.round(totalDelta / (players.length - 1));
  }

  return changes;
}

@Injectable()
export class ResultHandlerService {
  private readonly logger = new Logger(ResultHandlerService.name);

  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly activeMatches: ActiveMatchesService,
    private readonly eventBus: EventBusService,
    private readonly settlement: SettlementService,
  ) {}

  async handleMatchEnd(
    matchId: string,
    reason: string,
    forcedWinnerSide?: 'a' | 'b',
  ): Promise<void> {
    const matchState = this.activeMatches.getMatch(matchId);
    if (!matchState) {
      this.logger.error(`Match ${matchId} not found for result handling`);
      return;
    }

    if (matchState.clock) matchState.clock.stop();

    const matchDoc = await this.matchModel.findById(matchId);
    if (!matchDoc) {
      this.logger.error(`Match document ${matchId} not found in DB`);
      this.activeMatches.removeMatch(matchId);
      return;
    }

    const isPokerMultiplayer = !!(matchState.pokerAgents && matchState.pokerAgents.length > 0);

    if (isPokerMultiplayer) {
      await this.handlePokerMultiplayerEnd(matchId, matchState, matchDoc, reason, forcedWinnerSide);
    } else {
      await this.handleStandardEnd(matchId, matchState, matchDoc, reason, forcedWinnerSide);
    }
  }

  private async handleStandardEnd(
    matchId: string,
    matchState: ActiveMatchState,
    matchDoc: any,
    reason: string,
    forcedWinnerSide?: 'a' | 'b',
  ): Promise<void> {
    this.logger.log(`Handling match end: ${matchId}, reason=${reason}, forced=${forcedWinnerSide}`);

    const { winnerId, winningSide } = this.determineWinner(matchState, reason, forcedWinnerSide);
    const gameState = matchState.gameState;
    const finalScore = { a: gameState.scores.black, b: gameState.scores.white };

    const eloOutcome: 'a' | 'b' | 'draw' = winningSide ?? 'draw';
    const eloChanges = calculateEloChanges(
      matchDoc.agents.a.eloAtStart,
      matchDoc.agents.b.eloAtStart,
      eloOutcome,
    );

    let payoutTxHash: string | null = null;
    const hasEscrow = !!matchDoc.txHashes?.escrow;
    if (!hasEscrow && matchDoc.stakeAmount > 0) {
      this.logger.warn(`Skipping settlement for match ${matchId}: no escrow tx recorded on-chain`);
    } else if (hasEscrow) {
      try {
        if (winnerId && winningSide) {
          const potAmountAlpha = BigInt(matchDoc.potAmount) * BigInt(10 ** TOKEN_DECIMALS);
          const platformFeeAlpha = potAmountAlpha * BigInt(PLATFORM_FEE_PERCENT) / BigInt(100);
          const payoutAmountAlpha = potAmountAlpha - platformFeeAlpha;

          const winnerWallet = matchState.agents[winningSide].walletAddress;
          if (!winnerWallet) {
            this.logger.error(`No wallet address for winner (side=${winningSide}) in match ${matchId}`);
          } else {
            payoutTxHash = await this.settlement.payout(matchId, winnerWallet, payoutAmountAlpha);
          }
        } else {
          payoutTxHash = await this.settlement.refund(matchId);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Settlement failed for match ${matchId}: ${message}`);
      }
    }

    const matchResult = {
      winnerId: winnerId ?? null,
      reason,
      finalScore,
      totalMoves: gameState.moveNumber,
      eloChange: eloChanges,
    };

    await this.matchModel.updateOne(
      { _id: matchId },
      {
        status: 'completed',
        result: matchResult,
        currentBoard: gameState.board,
        endedAt: new Date(),
        ...(payoutTxHash ? { 'txHashes.payout': payoutTxHash } : {}),
      },
    );

    await this.updateAgentStats(
      matchState.agents.a.agentId,
      winningSide === 'a' ? 'win' : winningSide === 'b' ? 'loss' : 'draw',
      eloChanges.a,
      winningSide === 'a' ? this.calculateEarnings(matchDoc) : 0,
    );

    await this.updateAgentStats(
      matchState.agents.b.agentId,
      winningSide === 'b' ? 'win' : winningSide === 'a' ? 'loss' : 'draw',
      eloChanges.b,
      winningSide === 'b' ? this.calculateEarnings(matchDoc) : 0,
    );

    this.eventBus.emit('match:ended', {
      matchId,
      agentIds: { a: matchState.agents.a.agentId, b: matchState.agents.b.agentId },
      gameType: matchDoc.gameType ?? 'chess',
      result: { winnerId, reason, finalScore, totalMoves: gameState.moveNumber },
    });

    this.logger.log(`Match ${matchId} ended: winner=${winnerId}, reason=${reason}`);
    this.activeMatches.removeMatch(matchId);
  }

  private async handlePokerMultiplayerEnd(
    matchId: string,
    matchState: ActiveMatchState,
    matchDoc: any,
    reason: string,
    forcedWinnerSide?: 'a' | 'b',
  ): Promise<void> {
    const pokerAgents = matchState.pokerAgents!;
    const pokerPlayers = matchDoc.pokerPlayers ?? [];

    this.logger.log(`Handling poker multiplayer match end: ${matchId}, reason=${reason}, ${pokerAgents.length} players`);

    // Determine winner
    let winnerAgentId: string | null = null;
    if (forcedWinnerSide) {
      winnerAgentId = matchState.agents[forcedWinnerSide].agentId;
    } else {
      // Look at poker scores to find the winner
      const pokerScores = matchDoc.pokerScores as Record<string, number> | null;
      if (pokerScores) {
        let maxStack = 0;
        for (const [agentId, stack] of Object.entries(pokerScores)) {
          if (stack > maxStack) {
            maxStack = stack;
            winnerAgentId = agentId;
          }
        }
      }
    }

    // Build player info for ELO calculation
    const playerInfos = pokerPlayers.map((p: any) => ({
      agentId: p.agentId.toString(),
      eloAtStart: p.eloAtStart,
    }));

    const pokerEloChanges = calculatePokerEloChanges(playerInfos, winnerAgentId);

    // Settlement: payout to winner
    let payoutTxHash: string | null = null;
    const hasEscrow = !!matchDoc.txHashes?.escrow;
    if (!hasEscrow && matchDoc.stakeAmount > 0) {
      this.logger.warn(`Skipping settlement for poker match ${matchId}: no escrow tx recorded on-chain`);
    } else if (hasEscrow) {
      try {
        if (winnerAgentId) {
          const potAmountAlpha = BigInt(matchDoc.potAmount) * BigInt(10 ** TOKEN_DECIMALS);
          const platformFeeAlpha = potAmountAlpha * BigInt(PLATFORM_FEE_PERCENT) / BigInt(100);
          const payoutAmountAlpha = potAmountAlpha - platformFeeAlpha;

          const winnerAgent = pokerAgents.find(a => a.agentId === winnerAgentId);
          if (!winnerAgent?.walletAddress) {
            this.logger.error(`No wallet address for poker winner ${winnerAgentId} in match ${matchId}`);
          } else {
            payoutTxHash = await this.settlement.payout(matchId, winnerAgent.walletAddress, payoutAmountAlpha);
          }
        } else {
          payoutTxHash = await this.settlement.refund(matchId);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Settlement failed for poker match ${matchId}: ${message}`);
      }
    }

    // Build final scores
    const pokerFinalScores: Record<string, number> = {};
    const pokerScores = matchDoc.pokerScores as Record<string, number> | null;
    if (pokerScores) {
      for (const [k, v] of Object.entries(pokerScores)) {
        pokerFinalScores[k] = v;
      }
    }

    // Determine a/b compat scores
    const finalScore = {
      a: pokerFinalScores[matchState.agents.a.agentId] ?? 0,
      b: pokerFinalScores[matchState.agents.b.agentId] ?? 0,
    };

    const matchResult = {
      winnerId: winnerAgentId ?? null,
      reason,
      finalScore,
      totalMoves: matchState.gameState.moveNumber,
      eloChange: {
        a: pokerEloChanges[matchState.agents.a.agentId] ?? 0,
        b: pokerEloChanges[matchState.agents.b.agentId] ?? 0,
      },
      pokerFinalScores,
      pokerEloChanges,
    };

    await this.matchModel.updateOne(
      { _id: matchId },
      {
        status: 'completed',
        result: matchResult,
        endedAt: new Date(),
        ...(payoutTxHash ? { 'txHashes.payout': payoutTxHash } : {}),
      },
    );

    // Update stats for all players
    for (const agent of pokerAgents) {
      const isWinner = agent.agentId === winnerAgentId;
      const outcome: 'win' | 'loss' | 'draw' = isWinner ? 'win' : winnerAgentId ? 'loss' : 'draw';
      const eloDelta = pokerEloChanges[agent.agentId] ?? 0;
      const earnings = isWinner ? this.calculateEarnings(matchDoc) : 0;
      await this.updateAgentStats(agent.agentId, outcome, eloDelta, earnings);
    }

    this.eventBus.emit('match:ended', {
      matchId,
      agentIds: { a: matchState.agents.a.agentId, b: matchState.agents.b.agentId },
      pokerPlayerIds: pokerAgents.map(a => a.agentId),
      gameType: 'poker',
      result: {
        winnerId: winnerAgentId,
        reason,
        finalScore,
        totalMoves: matchState.gameState.moveNumber,
        pokerFinalScores,
      },
    });

    this.logger.log(`Poker match ${matchId} ended: winner=${winnerAgentId}, reason=${reason}, ${pokerAgents.length} players`);
    this.activeMatches.removeMatch(matchId);
  }

  private determineWinner(
    matchState: ActiveMatchState,
    reason: string,
    forcedWinnerSide?: 'a' | 'b',
  ): { winnerId: string | null; winningSide: 'a' | 'b' | null } {
    if (forcedWinnerSide) {
      return { winnerId: matchState.agents[forcedWinnerSide].agentId, winningSide: forcedWinnerSide };
    }

    const { winner } = matchState.gameState;
    if (winner === 'draw' || winner === null) {
      const { scores } = matchState.gameState;
      if (scores.black > scores.white) return { winnerId: matchState.agents.a.agentId, winningSide: 'a' };
      if (scores.white > scores.black) return { winnerId: matchState.agents.b.agentId, winningSide: 'b' };
      return { winnerId: null, winningSide: null };
    }

    const winningSide: 'a' | 'b' = winner === 'B' ? 'a' : 'b';
    return { winnerId: matchState.agents[winningSide].agentId, winningSide };
  }

  private calculateEarnings(matchDoc: any): number {
    const potAmount = matchDoc.potAmount;
    const platformFee = Math.floor(potAmount * (PLATFORM_FEE_PERCENT / 100));
    return potAmount - platformFee - matchDoc.stakeAmount;
  }

  private async updateAgentStats(
    agentId: string,
    outcome: 'win' | 'loss' | 'draw',
    eloDelta: number,
    earnings: number,
  ): Promise<void> {
    try {
      const statsUpdate: Record<string, number> = { 'stats.totalMatches': 1 };
      if (outcome === 'win') statsUpdate['stats.wins'] = 1;
      else if (outcome === 'loss') statsUpdate['stats.losses'] = 1;
      else statsUpdate['stats.draws'] = 1;
      if (earnings > 0) statsUpdate['stats.totalEarnings'] = earnings;

      await this.agentModel.updateOne(
        { _id: agentId },
        { $inc: { ...statsUpdate, eloRating: eloDelta }, $set: { status: 'idle' } },
      );

      const agent = await this.agentModel.findById(agentId);
      if (agent && agent.stats.totalMatches > 0) {
        const winRate = agent.stats.wins / agent.stats.totalMatches;
        await this.agentModel.updateOne(
          { _id: agentId },
          { $set: { 'stats.winRate': Math.round(winRate * 10000) / 10000 } },
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update agent ${agentId} stats: ${message}`);
    }
  }
}
