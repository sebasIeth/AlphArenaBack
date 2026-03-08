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
import { decrypt, encrypt } from '../common/crypto.util';
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

    // If user doesn't have a wallet yet, generate one
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
   */
  @Get(':matchId/info')
  async getInfo(@Param('matchId') matchId: string) {
    const match = await this.matchModel.findById(matchId).select('chain agents gameType status').lean();
    if (!match) throw new NotFoundException('Match not found');

    const chain = ((match as any).chain || 'base') as ChainName;

    const [matchInfo, pool] = await Promise.all([
      this.settlement.getMatchInfo(matchId, chain),
      this.settlement.getBettingPool(matchId, chain),
    ]);

    return {
      matchId,
      matchIdBytes32: this.settlement.toBytes32(matchId),
      chain,
      agents: (match as any).agents,
      gameType: (match as any).gameType,
      status: (match as any).status,
      onChain: matchInfo,
      pool,
      contracts: {
        arena: this.settlement.getContractAddress(chain),
        alpha: this.settlement.getAlphaAddress(chain),
      },
    };
  }

  /**
   * GET /betting/:matchId/pool
   */
  @Get(':matchId/pool')
  async getPool(@Param('matchId') matchId: string) {
    const match = await this.matchModel.findById(matchId).select('chain').lean();
    if (!match) throw new NotFoundException('Match not found');

    const chain = ((match as any).chain || 'base') as ChainName;
    const pool = await this.settlement.getBettingPool(matchId, chain);

    return {
      matchId,
      matchIdBytes32: this.settlement.toBytes32(matchId),
      chain,
      pool,
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

  // ── Authenticated write endpoints ─────────────────────────────────

  /**
   * POST /betting/place
   * Place a bet on a match. The backend handles approve + placeBet on-chain.
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

    // Check balance before attempting on-chain tx
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
   * Claim winnings or refund from a settled/refunded match.
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
      return {
        txHash,
        matchId: dto.matchId,
        chain,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Claim failed: ${message}`);
    }
  }

  /**
   * GET /betting/my-bets/:matchId
   * Get the authenticated user's bets on a match.
   */
  @Get('my-bets/:matchId')
  @UseGuards(JwtAuthGuard)
  async getMyBets(@CurrentUser() user: AuthPayload, @Param('matchId') matchId: string) {
    const match = await this.matchModel.findById(matchId).select('chain').lean();
    if (!match) throw new NotFoundException('Match not found');

    const { walletAddress } = await this.getUserWallet(user.userId);
    const chain = ((match as any).chain || 'base') as ChainName;
    const bets = await this.settlement.getUserBets(matchId, walletAddress, chain);

    return { matchId, chain, bets };
  }
}
