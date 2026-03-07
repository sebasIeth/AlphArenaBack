import { Controller, Post, Get, Body, UseGuards, HttpCode } from '@nestjs/common';
import { IsString, IsNumber, Min, Max, IsIn } from 'class-validator';
import { PlayService } from './play.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';
import { MIN_STAKE, MAX_STAKE } from '../common/constants/game.constants';

class JoinDto {
  @IsIn(['marrakech', 'chess', 'poker'])
  gameType: string;

  @IsNumber()
  @Min(MIN_STAKE)
  @Max(MAX_STAKE)
  stakeAmount: number;
}

class MoveDto {
  @IsString()
  matchId: string;

  move: unknown;
}

@Controller('play')
@UseGuards(JwtAuthGuard)
export class PlayController {
  constructor(private readonly playService: PlayService) {}

  @Post('join')
  @HttpCode(201)
  async join(@CurrentUser() user: AuthPayload, @Body() dto: JoinDto) {
    return this.playService.joinQueue(user.userId, dto.gameType, dto.stakeAmount);
  }

  @Post('cancel')
  async cancel(@CurrentUser() user: AuthPayload) {
    return this.playService.cancelQueue(user.userId);
  }

  @Get('status')
  async status(@CurrentUser() user: AuthPayload) {
    return this.playService.getStatus(user.userId);
  }

  @Get('balance')
  async balance(@CurrentUser() user: AuthPayload) {
    return this.playService.getBalance(user.userId);
  }

  @Post('move')
  async move(@CurrentUser() user: AuthPayload, @Body() dto: MoveDto) {
    return this.playService.submitMove(user.userId, dto.matchId, dto.move);
  }
}
