import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parseUnits } from 'viem';
import { Bet, Match, User } from '../database/schemas';
import { EventBusService } from '../orchestrator/event-bus.service';
import { SettlementService } from '../settlement/settlement.service';
import { MatchEndedEvent } from '../common/types';

const BETTING_FEE_PERCENT = 5;
const MIN_BET = 0.01;

export interface AgentPool {
  agentId: string;
  totalBets: number;
  betCount: number;
  percent: number;
  odds: number;
}

interface PoolResult {
  totalPool: number;
  noContest: boolean;
  agents: AgentPool[];
  /** @deprecated compat — equals agents[0].totalBets */
  totalBetsA: number;
  /** @deprecated compat — equals agents[1].totalBets */
  totalBetsB: number;
}

@Injectable()
export class BettingService implements OnModuleInit {
  private readonly logger = new Logger(BettingService.name);

  constructor(
    @InjectModel(Bet.name) private readonly betModel: Model<Bet>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly eventBus: EventBusService,
    private readonly settlement: SettlementService,
  ) {}

  onModuleInit() {
    this.eventBus.on('match:ended', (data: MatchEndedEvent) => {
      this.handleMatchSettlement(data).catch((err) => {
        this.logger.error(`Failed to settle bets for match ${data.matchId}: ${err.message}`);
      });
    });
  }

  /* ────────────────────────────────────────────────────────
     PLACE BET
     ──────────────────────────────────────────────────────── */
  async placeBet(userId: string, matchId: string, onAgentId: string, amount: number) {
    if (amount < MIN_BET) {
      throw new BadRequestException(`Minimum bet is ${MIN_BET}`);
    }

    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    if (!['pending', 'starting', 'active'].includes(match.status)) {
      throw new BadRequestException('Betting is closed for this match');
    }

    // Validate that onAgentId is a participant in this match
    const agentIds = this.getMatchAgentIds(match);
    if (!agentIds.includes(onAgentId)) {
      throw new BadRequestException('Agent is not a participant in this match');
    }

    const user = await this.userModel.findById(userId).select('+walletPrivateKey');
    if (!user) throw new NotFoundException('User not found');
    if (!user.walletAddress) throw new BadRequestException('No wallet linked to your account');

    const balanceStr = await this.settlement.getAgentUsdcBalance(user.walletAddress);
    const balanceNum = parseFloat(balanceStr);
    if (balanceNum < amount) {
      throw new BadRequestException(`Insufficient balance: you have ${balanceNum.toFixed(2)} ALPHA but tried to bet ${amount}`);
    }

    const decimals = this.settlement.getUsdcDecimals();
    const amountWei = parseUnits(amount.toString(), decimals);
    const platformAddress = this.settlement.getPlatformWalletAddress();

    let txHash: string | null = null;
    if (platformAddress && user.walletPrivateKey) {
      txHash = await this.settlement.transferUsdcFromAgent(
        user.walletPrivateKey,
        platformAddress,
        amountWei,
      );
    }

    if (!txHash) {
      this.logger.warn(`On-chain transfer skipped for bet (settlement not configured): user=${userId}, match=${matchId}`);
    }

    // Determine legacy onAgentA for backwards compat
    const onAgentA = onAgentId === match.agents.a.agentId.toString();

    const bet = await this.betModel.create({
      matchId,
      userId: new Types.ObjectId(userId),
      walletAddress: user.walletAddress,
      onAgentId,
      onAgentA,
      amount,
      txHash: txHash || null,
    });

    this.logger.log(`Bet placed: user=${userId}, match=${matchId}, onAgent=${onAgentId}, amount=${amount}, txHash=${txHash}`);

    return {
      txHash: txHash || bet._id.toString(),
      matchId,
      onAgentId,
      amount,
    };
  }

  /* ────────────────────────────────────────────────────────
     GET BETTING INFO (full info for a match)
     ──────────────────────────────────────────────────────── */
  async getBettingInfo(matchId: string) {
    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    const pool = await this.calculatePool(matchId, match);
    const isOpen = ['pending', 'starting', 'active'].includes(match.status);
    const isSettled = match.status === 'completed';
    const isRefunded = match.status === 'cancelled';

    let onChainState: 'none' | 'escrowed' | 'settled' | 'refunded' = 'escrowed';
    if (isSettled) onChainState = 'settled';
    else if (isRefunded) onChainState = 'refunded';

    let winner: { side: 'a' | 'b'; agentName: string; agentId: string } | null = null;
    if (match.result?.winnerId) {
      const winningSide = match.result.winnerId.toString() === match.agents.a.agentId.toString() ? 'a' : 'b';
      winner = {
        side: winningSide,
        agentName: match.agents[winningSide].name,
        agentId: match.agents[winningSide].agentId.toString(),
      };
    }

    return {
      matchId,
      chain: 'base',
      gameType: match.gameType,
      status: match.status,
      stakeAmount: match.stakeAmount,
      agents: {
        a: {
          agentId: match.agents.a.agentId.toString(),
          name: match.agents.a.name,
          eloAtStart: match.agents.a.eloAtStart,
        },
        b: {
          agentId: match.agents.b.agentId.toString(),
          name: match.agents.b.name,
          eloAtStart: match.agents.b.eloAtStart,
        },
      },
      betting: {
        open: isOpen,
        onChainState,
        pool: {
          totalPool: pool.totalPool,
          noContest: pool.noContest,
          agents: pool.agents,
          // Legacy compat
          totalBetsA: pool.totalBetsA,
          totalBetsB: pool.totalBetsB,
          percentA: pool.agents.find((a) => a.agentId === match.agents.a.agentId.toString())?.percent ?? 50,
          percentB: pool.agents.find((a) => a.agentId === match.agents.b.agentId.toString())?.percent ?? 50,
        },
        odds: Object.fromEntries(pool.agents.map((a) => [a.agentId, a.odds])),
        feePercent: BETTING_FEE_PERCENT,
      },
      winner,
      contracts: { arena: '', alpha: '' },
    };
  }

  /* ────────────────────────────────────────────────────────
     GET BETTING POOL
     ──────────────────────────────────────────────────────── */
  async getBettingPool(matchId: string) {
    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    const pool = await this.calculatePool(matchId, match);
    const isOpen = ['pending', 'starting', 'active'].includes(match.status);

    return {
      matchId,
      chain: 'base',
      status: match.status,
      bettingOpen: isOpen,
      pool: {
        totalPool: pool.totalPool,
        noContest: pool.noContest,
        agents: pool.agents,
        totalBetsA: pool.totalBetsA,
        totalBetsB: pool.totalBetsB,
      },
    };
  }

  /* ────────────────────────────────────────────────────────
     GET MY BETS (for a specific match)
     ──────────────────────────────────────────────────────── */
  async getMyBets(userId: string, matchId: string) {
    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    const userBets = await this.betModel.find({
      matchId,
      userId: new Types.ObjectId(userId),
    }).lean();

    // Group bets by agentId
    const betsByAgent: Record<string, number> = {};
    for (const bet of userBets) {
      const agentId = bet.onAgentId || (bet.onAgentA ? match.agents.a.agentId.toString() : match.agents.b.agentId.toString());
      betsByAgent[agentId] = (betsByAgent[agentId] || 0) + bet.amount;
    }

    const total = Object.values(betsByAgent).reduce((s, v) => s + v, 0);
    const claimed = userBets.length > 0 && userBets.every((b) => b.claimed);

    const pool = await this.calculatePool(matchId, match);
    const netMultiplier = 1 - BETTING_FEE_PERCENT / 100;

    // Calculate potential winnings per agent
    const potential: Record<string, number> = {};
    for (const ap of pool.agents) {
      const userBetOnThis = betsByAgent[ap.agentId] || 0;
      potential[ap.agentId] = ap.totalBets > 0 && userBetOnThis > 0
        ? (userBetOnThis / ap.totalBets) * pool.totalPool * netMultiplier
        : 0;
    }

    // Determine outcome
    let outcome: 'won' | 'lost' | 'refund' | 'pending' | 'no_bet' = 'no_bet';
    let winnings = 0;

    if (total === 0) {
      outcome = 'no_bet';
    } else if (match.status === 'cancelled') {
      outcome = 'refund';
      winnings = total;
    } else if (match.status === 'completed' && match.result?.winnerId) {
      const winnerId = match.result.winnerId.toString();
      const userBetOnWinner = (betsByAgent[winnerId] || 0) > 0;
      outcome = userBetOnWinner ? 'won' : 'lost';
      if (userBetOnWinner) winnings = potential[winnerId] || 0;
    } else if (match.status === 'completed' && !match.result?.winnerId) {
      outcome = 'refund';
      winnings = total * (1 - BETTING_FEE_PERCENT / 100);
    } else {
      outcome = 'pending';
    }

    const canClaim = (outcome === 'won' || outcome === 'refund') && !claimed && total > 0;

    const user = await this.userModel.findById(userId).lean();

    return {
      matchId,
      chain: 'base',
      walletAddress: user?.walletAddress || '',
      bets: {
        byAgent: betsByAgent,
        total: total.toFixed(2),
        claimed,
        // Legacy compat
        onA: (betsByAgent[match.agents.a.agentId.toString()] || 0).toFixed(2),
        onB: (betsByAgent[match.agents.b.agentId.toString()] || 0).toFixed(2),
      },
      potential,
      outcome,
      winnings,
      canClaim,
    };
  }

  /* ────────────────────────────────────────────────────────
     CLAIM BET
     ──────────────────────────────────────────────────────── */
  async claimBet(userId: string, matchId: string) {
    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    if (!['completed', 'cancelled'].includes(match.status)) {
      throw new BadRequestException('Match is not yet settled');
    }

    const userBets = await this.betModel.find({
      matchId,
      userId: new Types.ObjectId(userId),
      claimed: false,
    });

    if (userBets.length === 0) {
      throw new BadRequestException('No unclaimed bets found');
    }

    // Group by agentId
    const betsByAgent: Record<string, number> = {};
    for (const bet of userBets) {
      const agentId = bet.onAgentId || (bet.onAgentA ? match.agents.a.agentId.toString() : match.agents.b.agentId.toString());
      betsByAgent[agentId] = (betsByAgent[agentId] || 0) + bet.amount;
    }
    const total = Object.values(betsByAgent).reduce((s, v) => s + v, 0);

    let payout = 0;

    if (match.status === 'cancelled') {
      payout = total; // Full refund only on cancellation
    } else if (match.status === 'completed' && !match.result?.winnerId) {
      // Draw — refund minus platform fee
      payout = total * (1 - BETTING_FEE_PERCENT / 100);
    } else if (match.result?.winnerId) {
      const winnerId = match.result.winnerId.toString();
      const userBetOnWinner = (betsByAgent[winnerId] || 0) > 0;

      if (userBetOnWinner) {
        const pool = await this.calculatePool(matchId, match);
        const winnerPool = pool.agents.find((a) => a.agentId === winnerId);
        const userWinnerBet = betsByAgent[winnerId];
        payout = winnerPool && winnerPool.totalBets > 0
          ? (userWinnerBet / winnerPool.totalBets) * pool.totalPool * (1 - BETTING_FEE_PERCENT / 100)
          : 0;
      }
    }

    let txHash: string | null = null;
    if (payout > 0) {
      const user = await this.userModel.findById(userId);
      if (user?.walletAddress) {
        const decimals = this.settlement.getUsdcDecimals();
        const payoutWei = parseUnits(payout.toString(), decimals);
        txHash = await this.settlement.transferUsdcFromPlatform(
          user.walletAddress,
          payoutWei,
        );
      }
    }

    await this.betModel.updateMany(
      { matchId, userId: new Types.ObjectId(userId), claimed: false },
      { claimed: true },
    );

    this.logger.log(`Bet claimed: user=${userId}, match=${matchId}, payout=${payout}, txHash=${txHash}`);

    return {
      txHash: txHash || `claim-${matchId}-${userId}`,
      matchId,
      chain: 'base',
    };
  }

  /* ────────────────────────────────────────────────────────
     GET MY PENDING CLAIMS
     ──────────────────────────────────────────────────────── */
  async getMyPendingClaims(userId: string) {
    const unclaimedBets = await this.betModel.find({
      userId: new Types.ObjectId(userId),
      claimed: false,
    }).lean();

    if (unclaimedBets.length === 0) return { claims: [] };

    const matchIds = [...new Set(unclaimedBets.map((b) => b.matchId))];

    const matches = await this.matchModel.find({
      _id: { $in: matchIds },
      status: { $in: ['completed', 'cancelled'] },
    }).lean();

    const claims: Array<{
      matchId: string;
      chain: string;
      gameType: string;
      outcome: 'won' | 'refund';
      betsByAgent: Record<string, number>;
      winnings: number;
      endedAt: string;
    }> = [];

    for (const match of matches) {
      const mId = (match as any)._id.toString();
      const betsForMatch = unclaimedBets.filter((b) => b.matchId === mId);

      const betsByAgent: Record<string, number> = {};
      for (const bet of betsForMatch) {
        const agentId = bet.onAgentId || (bet.onAgentA ? match.agents.a.agentId.toString() : match.agents.b.agentId.toString());
        betsByAgent[agentId] = (betsByAgent[agentId] || 0) + bet.amount;
      }
      const total = Object.values(betsByAgent).reduce((s, v) => s + v, 0);

      let outcome: 'won' | 'refund' = 'refund';
      // Draw refund still charges platform fee
      let winnings = match.status === 'cancelled' ? total : total * (1 - BETTING_FEE_PERCENT / 100);

      if (match.status === 'completed' && match.result?.winnerId) {
        const winnerId = match.result.winnerId.toString();
        const userBetOnWinner = (betsByAgent[winnerId] || 0) > 0;

        if (userBetOnWinner) {
          outcome = 'won';
          const pool = await this.calculatePool(mId, match);
          const winnerPool = pool.agents.find((a) => a.agentId === winnerId);
          const userWinnerBet = betsByAgent[winnerId];
          winnings = winnerPool && winnerPool.totalBets > 0
            ? (userWinnerBet / winnerPool.totalBets) * pool.totalPool * (1 - BETTING_FEE_PERCENT / 100)
            : 0;
        } else {
          continue;
        }
      }

      claims.push({
        matchId: mId,
        chain: 'base',
        gameType: match.gameType,
        outcome,
        betsByAgent,
        winnings,
        endedAt: (match.endedAt || match.updatedAt || match.createdAt).toISOString(),
      });
    }

    return { claims };
  }

  /* ────────────────────────────────────────────────────────
     INTERNAL: Get all agent IDs from a match
     ──────────────────────────────────────────────────────── */
  private getMatchAgentIds(match: any): string[] {
    if (!match.agents) return [];
    return Object.values(match.agents)
      .filter((a: any) => a?.agentId)
      .map((a: any) => a.agentId.toString());
  }

  /* ────────────────────────────────────────────────────────
     INTERNAL: Calculate pool aggregates (N agents)
     Pari-mutuel: odds adjust dynamically as more bets
     come in on a given agent (like football betting).
     The more people bet on an agent, the lower the payout.
     ──────────────────────────────────────────────────────── */
  private async calculatePool(matchId: string, match?: any): Promise<PoolResult> {
    const bets = await this.betModel.find({ matchId }).lean();

    // Resolve agentId for each bet (compat with old onAgentA bets)
    const resolvedBets = bets.map((b) => ({
      ...b,
      resolvedAgentId: b.onAgentId || (match && b.onAgentA != null
        ? (b.onAgentA ? match.agents.a.agentId.toString() : match.agents.b.agentId.toString())
        : 'unknown'),
    }));

    // Aggregate by agentId
    const agentTotals = new Map<string, { total: number; count: number }>();
    for (const bet of resolvedBets) {
      const curr = agentTotals.get(bet.resolvedAgentId) || { total: 0, count: 0 };
      curr.total += bet.amount;
      curr.count += 1;
      agentTotals.set(bet.resolvedAgentId, curr);
    }

    // Ensure all match agents appear even with 0 bets
    if (match) {
      for (const id of this.getMatchAgentIds(match)) {
        if (!agentTotals.has(id)) agentTotals.set(id, { total: 0, count: 0 });
      }
    }

    const totalPool = resolvedBets.reduce((s, b) => s + b.amount, 0);
    const netMultiplier = 1 - BETTING_FEE_PERCENT / 100;
    const agentCount = agentTotals.size || 1;

    const agents: AgentPool[] = [];
    for (const [agentId, { total, count }] of agentTotals) {
      agents.push({
        agentId,
        totalBets: total,
        betCount: count,
        percent: totalPool > 0 ? Math.round((total / totalPool) * 100) : Math.round(100 / agentCount),
        odds: total > 0 ? (totalPool / total) * netMultiplier : 0,
      });
    }

    // Sort by totalBets desc (favorite first)
    agents.sort((x, y) => y.totalBets - x.totalBets);

    // Legacy compat fields
    const agentA = match ? match.agents.a.agentId.toString() : '';
    const agentB = match ? match.agents.b.agentId.toString() : '';

    return {
      totalPool,
      noContest: totalPool === 0,
      agents,
      totalBetsA: agents.find((a) => a.agentId === agentA)?.totalBets ?? 0,
      totalBetsB: agents.find((a) => a.agentId === agentB)?.totalBets ?? 0,
    };
  }

  /* ────────────────────────────────────────────────────────
     EVENT HANDLER: Auto-settle when match ends
     ──────────────────────────────────────────────────────── */
  private async handleMatchSettlement(event: MatchEndedEvent): Promise<void> {
    const betsCount = await this.betModel.countDocuments({ matchId: event.matchId });
    if (betsCount === 0) return;

    this.logger.log(`Match ${event.matchId} ended — ${betsCount} bets to settle`);
  }
}
