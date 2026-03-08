import {
  Controller, Get, Post, Param, Query, Body,
  NotFoundException, BadRequestException, UseGuards, HttpCode,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IsString, IsBoolean, IsNumber, Min } from 'class-validator';
import { SettlementService } from './settlement.service';
import { Match, User } from '../database/schemas';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';
import { type ChainName, TOKEN_DECIMALS } from '../common/constants/game.constants';
import { decrypt } from '../common/crypto.util';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

class PlaceBetDto {
  @IsString()
  matchId: string;

  @IsBoolean()
  onAgentA: boolean;

  @IsNumber()
  @Min(1)
  amount: number;
}

class ClaimBetDto {
  @IsString()
  matchId: string;
}

const MATCH_STATE_LABELS: Record<number, string> = {
  0: 'none',
  1: 'escrowed',
  2: 'settled',
  3: 'refunded',
};

@Controller('betting')
export class BettingController {
  constructor(
    private readonly settlement: SettlementService,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  private async getUserWallet(userId: string): Promise<{ walletAddress: string; privateKey: string }> {
    const userDoc = await this.userModel.findById(userId).select('+walletPrivateKey');
    if (!userDoc) throw new NotFoundException('User not found');

    if (!userDoc.walletAddress || !userDoc.walletPrivateKey) {
      const privKey = generatePrivateKey();
      const account = privateKeyToAccount(privKey);
      userDoc.walletAddress = account.address;
      userDoc.walletPrivateKey = privKey;
      await userDoc.save();
    }

    return {
      walletAddress: userDoc.walletAddress,
      privateKey: decrypt(userDoc.walletPrivateKey),
    };
  }

  // ── Public read endpoints ─────────────────────────────────────────

  /**
   * GET /betting/contracts?chain=base|celo
   */
  @Get('contracts')
  getContracts(@Query('chain') chain?: string) {
    const chainName = (chain === 'celo' ? 'celo' : 'base') as ChainName;
    return {
      chain: chainName,
      arena: this.settlement.getContractAddress(chainName),
      alpha: this.settlement.getAlphaAddress(chainName),
      tokenDecimals: TOKEN_DECIMALS,
      available: this.settlement.getConfiguredChains().includes(chainName),
    };
  }

  /**
   * GET /betting/:matchId/info
   * Full betting dashboard data for a match.
   */
  @Get(':matchId/info')
  async getInfo(@Param('matchId') matchId: string) {
    const match = await this.matchModel.findById(matchId)
      .select('chain agents gameType status stakeAmount potAmount result')
      .lean();
    if (!match) throw new NotFoundException('Match not found');

    const m = match as any;
    const chain = (m.chain || 'base') as ChainName;

    const [matchInfo, pool] = await Promise.all([
      this.settlement.getMatchInfo(matchId, chain),
      this.settlement.getBettingPool(matchId, chain),
    ]);

    const onChainState = matchInfo ? Number(matchInfo.state) : 0;
    const bettingOpen = onChainState === 1 && m.status === 'active';

    // Pool calculations
    const totalA = parseFloat(pool?.totalBetsA || '0');
    const totalB = parseFloat(pool?.totalBetsB || '0');
    const totalPool = totalA + totalB;
    const pctA = totalPool > 0 ? Math.round((totalA / totalPool) * 10000) / 100 : 50;
    const pctB = totalPool > 0 ? Math.round((totalB / totalPool) * 10000) / 100 : 50;

    // Potential payout multipliers (what you'd get per 1 ALPHA bet, after 5% fee)
    const netMultiplier = 0.95; // 5% fee
    const oddsA = totalA > 0 ? (totalPool * netMultiplier) / totalA : 0;
    const oddsB = totalB > 0 ? (totalPool * netMultiplier) / totalB : 0;

    // Winner info (if match is completed)
    let winner: { side: string; agentName: string; agentId: string } | null = null;
    if (m.status === 'completed' && m.result?.winnerId) {
      const winningSide = m.result.winnerId === m.agents.a.agentId ? 'a' : 'b';
      winner = {
        side: winningSide,
        agentName: m.agents[winningSide].name,
        agentId: m.result.winnerId,
      };
    }

    return {
      matchId,
      matchIdBytes32: this.settlement.toBytes32(matchId),
      chain,
      gameType: m.gameType,
      status: m.status,
      stakeAmount: m.stakeAmount,

      agents: {
        a: { agentId: m.agents.a.agentId, name: m.agents.a.name, eloAtStart: m.agents.a.eloAtStart },
        b: { agentId: m.agents.b.agentId, name: m.agents.b.name, eloAtStart: m.agents.b.eloAtStart },
      },

      betting: {
        open: bettingOpen,
        onChainState: MATCH_STATE_LABELS[onChainState] || 'unknown',
        pool: {
          totalBetsA: pool?.totalBetsA || '0',
          totalBetsB: pool?.totalBetsB || '0',
          totalPool: totalPool.toString(),
          netPool: pool?.netPool || '0',
          noContest: pool?.noContest || false,
          percentA: pctA,
          percentB: pctB,
        },
        odds: {
          a: Math.round(oddsA * 100) / 100,
          b: Math.round(oddsB * 100) / 100,
        },
        feePercent: 5,
      },

      winner,

      contracts: {
        arena: this.settlement.getContractAddress(chain),
        alpha: this.settlement.getAlphaAddress(chain),
      },
    };
  }

  /**
   * GET /betting/:matchId/pool
   * Lightweight pool data for polling.
   */
  @Get(':matchId/pool')
  async getPool(@Param('matchId') matchId: string) {
    const match = await this.matchModel.findById(matchId).select('chain status').lean();
    if (!match) throw new NotFoundException('Match not found');

    const m = match as any;
    const chain = (m.chain || 'base') as ChainName;
    const pool = await this.settlement.getBettingPool(matchId, chain);

    const totalA = parseFloat(pool?.totalBetsA || '0');
    const totalB = parseFloat(pool?.totalBetsB || '0');
    const totalPool = totalA + totalB;
    const pctA = totalPool > 0 ? Math.round((totalA / totalPool) * 10000) / 100 : 50;
    const pctB = totalPool > 0 ? Math.round((totalB / totalPool) * 10000) / 100 : 50;

    return {
      matchId,
      chain,
      status: m.status,
      bettingOpen: m.status === 'active',
      pool: {
        totalBetsA: pool?.totalBetsA || '0',
        totalBetsB: pool?.totalBetsB || '0',
        totalPool: totalPool.toString(),
        noContest: pool?.noContest || false,
        percentA: pctA,
        percentB: pctB,
      },
    };
  }

  /**
   * GET /betting/:matchId/user-bets?address=0x...
   */
  @Get(':matchId/user-bets')
  async getUserBets(
    @Param('matchId') matchId: string,
    @Query('address') address: string,
  ) {
    if (!address) throw new BadRequestException('address query param is required');

    const match = await this.matchModel.findById(matchId).select('chain').lean();
    if (!match) throw new NotFoundException('Match not found');

    const chain = ((match as any).chain || 'base') as ChainName;
    const bets = await this.settlement.getUserBets(matchId, address, chain);

    return { matchId, chain, address, bets };
  }

  // ── Authenticated endpoints ───────────────────────────────────────

  /**
   * POST /betting/place
   */
  @Post('place')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async placeBet(@CurrentUser() user: AuthPayload, @Body() dto: PlaceBetDto) {
    const match = await this.matchModel.findById(dto.matchId).select('chain status').lean();
    if (!match) throw new NotFoundException('Match not found');
    if ((match as any).status !== 'active') {
      throw new BadRequestException(`Cannot bet on a match with status "${(match as any).status}". Match must be active.`);
    }

    const { walletAddress, privateKey } = await this.getUserWallet(user.userId);
    const chain = ((match as any).chain || 'base') as ChainName;
    const amountAlpha = BigInt(dto.amount) * BigInt(10 ** TOKEN_DECIMALS);

    const balance = await this.settlement.getAgentAlphaBalance(walletAddress, chain);
    if (parseFloat(balance) < dto.amount) {
      throw new BadRequestException(
        `Insufficient ALPHA balance to bet. You have ${balance} ALPHA but tried to bet ${dto.amount}. Deposit ALPHA to ${walletAddress} on ${chain}.`,
      );
    }

    try {
      const txHash = await this.settlement.placeBet(dto.matchId, privateKey, dto.onAgentA, amountAlpha, chain);
      return {
        txHash,
        matchId: dto.matchId,
        onAgentA: dto.onAgentA,
        amount: dto.amount,
        chain,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Bet failed: ${message}`);
    }
  }

  /**
   * POST /betting/claim
   */
  @Post('claim')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async claimBet(@CurrentUser() user: AuthPayload, @Body() dto: ClaimBetDto) {
    const match = await this.matchModel.findById(dto.matchId).select('chain status').lean();
    if (!match) throw new NotFoundException('Match not found');
    if ((match as any).status !== 'completed' && (match as any).status !== 'error') {
      throw new BadRequestException(`Cannot claim on a match with status "${(match as any).status}". Match must be completed.`);
    }

    const { privateKey } = await this.getUserWallet(user.userId);
    const chain = ((match as any).chain || 'base') as ChainName;

    try {
      const txHash = await this.settlement.claimBet(dto.matchId, privateKey, chain);
      return { txHash, matchId: dto.matchId, chain };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Claim failed: ${message}`);
    }
  }

  /**
   * GET /betting/my-bets/:matchId
   * Authenticated user's bets + potential winnings.
   */
  @Get('my-bets/:matchId')
  @UseGuards(JwtAuthGuard)
  async getMyBets(@CurrentUser() user: AuthPayload, @Param('matchId') matchId: string) {
    const match = await this.matchModel.findById(matchId).select('chain status result agents').lean();
    if (!match) throw new NotFoundException('Match not found');

    const m = match as any;
    const { walletAddress } = await this.getUserWallet(user.userId);
    const chain = (m.chain || 'base') as ChainName;

    const [bets, pool] = await Promise.all([
      this.settlement.getUserBets(matchId, walletAddress, chain),
      this.settlement.getBettingPool(matchId, chain),
    ]);

    const myBetOnA = parseFloat(bets?.betOnA || '0');
    const myBetOnB = parseFloat(bets?.betOnB || '0');
    const myTotalBet = myBetOnA + myBetOnB;
    const totalA = parseFloat(pool?.totalBetsA || '0');
    const totalB = parseFloat(pool?.totalBetsB || '0');
    const totalPool = totalA + totalB;

    // Calculate potential/actual winnings
    let potentialWinA = 0;
    let potentialWinB = 0;
    const netPool = totalPool * 0.95; // after 5% fee

    if (myBetOnA > 0 && totalA > 0) {
      potentialWinA = (myBetOnA / totalA) * netPool;
    }
    if (myBetOnB > 0 && totalB > 0) {
      potentialWinB = (myBetOnB / totalB) * netPool;
    }

    // Determine outcome if match is completed
    let outcome: 'won' | 'lost' | 'refund' | 'pending' | 'no_bet' = 'pending';
    let winnings = 0;

    if (myTotalBet === 0) {
      outcome = 'no_bet';
    } else if (m.status === 'completed') {
      if (pool?.noContest) {
        outcome = 'refund';
        winnings = myTotalBet;
      } else if (m.result?.winnerId) {
        const winningSide = m.result.winnerId === m.agents.a.agentId ? 'a' : 'b';
        if (winningSide === 'a' && myBetOnA > 0) {
          outcome = 'won';
          winnings = potentialWinA;
        } else if (winningSide === 'b' && myBetOnB > 0) {
          outcome = 'won';
          winnings = potentialWinB;
        } else {
          outcome = 'lost';
        }
      } else {
        // Draw
        outcome = 'refund';
        winnings = myTotalBet;
      }
    }

    return {
      matchId,
      chain,
      walletAddress,
      bets: {
        onA: bets?.betOnA || '0',
        onB: bets?.betOnB || '0',
        total: myTotalBet.toString(),
        claimed: bets?.claimed || false,
      },
      potential: {
        winIfA: Math.round(potentialWinA * 100) / 100,
        winIfB: Math.round(potentialWinB * 100) / 100,
      },
      outcome,
      winnings: Math.round(winnings * 100) / 100,
      canClaim: outcome === 'won' || outcome === 'refund' ? !(bets?.claimed) : false,
    };
  }
}
