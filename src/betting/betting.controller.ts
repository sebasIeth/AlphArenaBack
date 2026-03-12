import {
  Controller, Get, Post, Body, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import { IsString, IsBoolean, IsNumber, Min } from 'class-validator';
import { BettingService } from './betting.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';

class PlaceBetDto {
  @IsString() matchId: string;
  @IsBoolean() onAgentA: boolean;
  @IsNumber() @Min(0.01) amount: number;
}

class ClaimBetDto {
  @IsString() matchId: string;
}

@Controller('betting')
export class BettingController {
  constructor(private readonly service: BettingService) {}

  /** Public — get betting contract addresses (stub) */
  @Get('contracts')
  getContracts() {
    return { arena: '', alpha: '', chain: 'base' };
  }

  /** Public — get full betting info for a match */
  @Get(':matchId/info')
  async getBettingInfo(@Param('matchId') matchId: string) {
    return this.service.getBettingInfo(matchId);
  }

  /** Public — get betting pool for a match */
  @Get(':matchId/pool')
  async getBettingPool(@Param('matchId') matchId: string) {
    return this.service.getBettingPool(matchId);
  }

  /** Auth — get my bets for a specific match */
  @Get('my-bets/:matchId')
  @UseGuards(JwtAuthGuard)
  async getMyBets(
    @CurrentUser() user: AuthPayload,
    @Param('matchId') matchId: string,
  ) {
    return this.service.getMyBets(user.userId, matchId);
  }

  /** Auth — get all my pending claims */
  @Get('my-pending-claims')
  @UseGuards(JwtAuthGuard)
  async getMyPendingClaims(@CurrentUser() user: AuthPayload) {
    return this.service.getMyPendingClaims(user.userId);
  }

  /** Auth — place a bet */
  @Post('place')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async placeBet(
    @CurrentUser() user: AuthPayload,
    @Body() dto: PlaceBetDto,
  ) {
    return this.service.placeBet(user.userId, dto.matchId, dto.onAgentA, dto.amount);
  }

  /** Auth — claim bet winnings/refund */
  @Post('claim')
  @UseGuards(JwtAuthGuard)
  async claimBet(
    @CurrentUser() user: AuthPayload,
    @Body() dto: ClaimBetDto,
  ) {
    return this.service.claimBet(user.userId, dto.matchId);
  }
}
