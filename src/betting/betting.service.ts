import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
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
  async placeBet(userId: string, matchId: string, onAgentA: boolean, amount: number) {
    if (amount < MIN_BET) {
      throw new BadRequestException(`Minimum bet is ${MIN_BET}`);
    }

    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    // Betting is open only while match is starting or active
    if (!['starting', 'active'].includes(match.status)) {
      throw new BadRequestException('Betting is closed for this match');
    }

    // Need walletPrivateKey for on-chain transfer (select: false field)
    const user = await this.userModel.findById(userId).select('+walletPrivateKey');
    if (!user) throw new NotFoundException('User not found');
    if (!user.walletAddress) throw new BadRequestException('No wallet linked to your account');

    // Check on-chain USDC balance
    const balanceStr = await this.settlement.getAgentUsdcBalance(user.walletAddress);
    const balanceNum = parseFloat(balanceStr);
    if (balanceNum < amount) {
      throw new BadRequestException(`Insufficient balance: you have ${balanceNum.toFixed(2)} ALPHA but tried to bet ${amount}`);
    }

    // Transfer USDC from user wallet → platform wallet
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

    const bet = await this.betModel.create({
      matchId,
      userId: new Types.ObjectId(userId),
      walletAddress: user.walletAddress,
      onAgentA,
      amount,
      txHash: txHash || null,
    });

    this.logger.log(`Bet placed: user=${userId}, match=${matchId}, onA=${onAgentA}, amount=${amount}, txHash=${txHash}`);

    return {
      txHash: txHash || bet._id.toString(),
      matchId,
      onAgentA,
      amount,
    };
  }

  /* ────────────────────────────────────────────────────────
     GET BETTING INFO (full info for a match)
     ──────────────────────────────────────────────────────── */
  async getBettingInfo(matchId: string) {
    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    const pool = await this.calculatePool(matchId);
    const isOpen = ['starting', 'active'].includes(match.status);
    const isSettled = match.status === 'completed';
    const isRefunded = match.status === 'cancelled';

    let onChainState: 'none' | 'escrowed' | 'settled' | 'refunded' = 'escrowed';
    if (isSettled) onChainState = 'settled';
    else if (isRefunded) onChainState = 'refunded';

    const odds = this.calculateOdds(pool);

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
        pool,
        odds,
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

    const pool = await this.calculatePool(matchId);
    const isOpen = ['starting', 'active'].includes(match.status);

    return {
      matchId,
      chain: 'base',
      status: match.status,
      bettingOpen: isOpen,
      pool,
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

    const onA = userBets.filter((b) => b.onAgentA).reduce((s, b) => s + b.amount, 0);
    const onB = userBets.filter((b) => !b.onAgentA).reduce((s, b) => s + b.amount, 0);
    const total = onA + onB;
    const claimed = userBets.length > 0 && userBets.every((b) => b.claimed);

    // Calculate potential winnings
    const pool = await this.calculatePool(matchId);
    const winIfA = pool.totalPool > 0 && pool.totalBetsA > 0
      ? (onA / pool.totalBetsA) * pool.totalPool * (1 - BETTING_FEE_PERCENT / 100)
      : 0;
    const winIfB = pool.totalPool > 0 && pool.totalBetsB > 0
      ? (onB / pool.totalBetsB) * pool.totalPool * (1 - BETTING_FEE_PERCENT / 100)
      : 0;

    // Determine outcome
    let outcome: 'won' | 'lost' | 'refund' | 'pending' | 'no_bet' = 'no_bet';
    if (total === 0) {
      outcome = 'no_bet';
    } else if (match.status === 'cancelled') {
      outcome = 'refund';
    } else if (match.status === 'completed' && match.result?.winnerId) {
      const winningSide = match.result.winnerId.toString() === match.agents.a.agentId.toString() ? 'a' : 'b';
      const userBetOnWinner = winningSide === 'a' ? onA > 0 : onB > 0;
      outcome = userBetOnWinner ? 'won' : 'lost';
    } else if (match.status === 'completed' && !match.result?.winnerId) {
      outcome = 'refund'; // draw = refund
    } else {
      outcome = 'pending';
    }

    // Calculate actual winnings
    let winnings = 0;
    if (outcome === 'won') {
      const winningSide = match.result!.winnerId!.toString() === match.agents.a.agentId.toString() ? 'a' : 'b';
      winnings = winningSide === 'a' ? winIfA : winIfB;
    } else if (outcome === 'refund') {
      winnings = total;
    }

    const canClaim = (outcome === 'won' || outcome === 'refund') && !claimed && total > 0;

    const user = await this.userModel.findById(userId).lean();

    return {
      matchId,
      chain: 'base',
      walletAddress: user?.walletAddress || '',
      bets: {
        onA: onA.toFixed(2),
        onB: onB.toFixed(2),
        total: total.toFixed(2),
        claimed,
      },
      potential: { winIfA, winIfB },
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

    const onA = userBets.filter((b) => b.onAgentA).reduce((s, b) => s + b.amount, 0);
    const onB = userBets.filter((b) => !b.onAgentA).reduce((s, b) => s + b.amount, 0);
    const total = onA + onB;

    let payout = 0;

    if (match.status === 'cancelled' || (match.status === 'completed' && !match.result?.winnerId)) {
      // Refund: return original bet amounts
      payout = total;
    } else if (match.result?.winnerId) {
      const winningSide = match.result.winnerId.toString() === match.agents.a.agentId.toString() ? 'a' : 'b';
      const userBetOnWinner = winningSide === 'a' ? onA > 0 : onB > 0;

      if (userBetOnWinner) {
        const pool = await this.calculatePool(matchId);
        const winnerBetAmount = winningSide === 'a' ? onA : onB;
        const winnerPoolTotal = winningSide === 'a' ? pool.totalBetsA : pool.totalBetsB;
        payout = winnerPoolTotal > 0
          ? (winnerBetAmount / winnerPoolTotal) * pool.totalPool * (1 - BETTING_FEE_PERCENT / 100)
          : 0;
      }
      // If user bet on loser, payout stays 0
    }

    // Transfer USDC from platform → user wallet
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

    // Mark bets as claimed
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
    // Find all unclaimed bets for this user
    const unclaimedBets = await this.betModel.find({
      userId: new Types.ObjectId(userId),
      claimed: false,
    }).lean();

    if (unclaimedBets.length === 0) return { claims: [] };

    // Group by matchId
    const matchIds = [...new Set(unclaimedBets.map((b) => b.matchId))];

    // Fetch matches that are completed or cancelled
    const matches = await this.matchModel.find({
      _id: { $in: matchIds },
      status: { $in: ['completed', 'cancelled'] },
    }).lean();

    const claims: Array<{
      matchId: string;
      chain: string;
      gameType: string;
      outcome: 'won' | 'refund';
      betOnA: string;
      betOnB: string;
      winnings: number;
      endedAt: string;
    }> = [];

    for (const match of matches) {
      const mId = (match as any)._id.toString();
      const betsForMatch = unclaimedBets.filter((b) => b.matchId === mId);
      const onA = betsForMatch.filter((b) => b.onAgentA).reduce((s, b) => s + b.amount, 0);
      const onB = betsForMatch.filter((b) => !b.onAgentA).reduce((s, b) => s + b.amount, 0);
      const total = onA + onB;

      let outcome: 'won' | 'refund' = 'refund';
      let winnings = total; // default refund

      if (match.status === 'completed' && match.result?.winnerId) {
        const winningSide = match.result.winnerId.toString() === match.agents.a.agentId.toString() ? 'a' : 'b';
        const userBetOnWinner = winningSide === 'a' ? onA > 0 : onB > 0;

        if (userBetOnWinner) {
          outcome = 'won';
          const pool = await this.calculatePool(mId);
          const winnerBet = winningSide === 'a' ? onA : onB;
          const winnerPoolTotal = winningSide === 'a' ? pool.totalBetsA : pool.totalBetsB;
          winnings = winnerPoolTotal > 0
            ? (winnerBet / winnerPoolTotal) * pool.totalPool * (1 - BETTING_FEE_PERCENT / 100)
            : 0;
        } else {
          // User bet on loser — no claim
          continue;
        }
      }

      claims.push({
        matchId: mId,
        chain: 'base',
        gameType: match.gameType,
        outcome,
        betOnA: onA.toFixed(2),
        betOnB: onB.toFixed(2),
        winnings,
        endedAt: (match.endedAt || match.updatedAt || match.createdAt).toISOString(),
      });
    }

    return { claims };
  }

  /* ────────────────────────────────────────────────────────
     INTERNAL: Calculate pool aggregates
     ──────────────────────────────────────────────────────── */
  private async calculatePool(matchId: string) {
    const bets = await this.betModel.find({ matchId }).lean();
    const totalBetsA = bets.filter((b) => b.onAgentA).reduce((s, b) => s + b.amount, 0);
    const totalBetsB = bets.filter((b) => !b.onAgentA).reduce((s, b) => s + b.amount, 0);
    const totalPool = totalBetsA + totalBetsB;

    return {
      totalBetsA,
      totalBetsB,
      totalPool,
      noContest: totalPool === 0,
      percentA: totalPool > 0 ? Math.round((totalBetsA / totalPool) * 100) : 50,
      percentB: totalPool > 0 ? Math.round((totalBetsB / totalPool) * 100) : 50,
    };
  }

  /* ────────────────────────────────────────────────────────
     INTERNAL: Calculate odds
     ──────────────────────────────────────────────────────── */
  private calculateOdds(pool: { totalBetsA: number; totalBetsB: number; totalPool: number }) {
    if (pool.totalPool === 0) return { a: 2, b: 2 };
    const netMultiplier = 1 - BETTING_FEE_PERCENT / 100;
    return {
      a: pool.totalBetsA > 0 ? (pool.totalPool / pool.totalBetsA) * netMultiplier : 0,
      b: pool.totalBetsB > 0 ? (pool.totalPool / pool.totalBetsB) * netMultiplier : 0,
    };
  }

  /* ────────────────────────────────────────────────────────
     EVENT HANDLER: Auto-settle when match ends
     ──────────────────────────────────────────────────────── */
  private async handleMatchSettlement(event: MatchEndedEvent): Promise<void> {
    const betsCount = await this.betModel.countDocuments({ matchId: event.matchId });
    if (betsCount === 0) return;

    this.logger.log(`Match ${event.matchId} ended — ${betsCount} bets to settle`);
    // Bets are settled lazily when users claim.
    // This handler is a hook point for future auto-settlement or notifications.
  }
}
