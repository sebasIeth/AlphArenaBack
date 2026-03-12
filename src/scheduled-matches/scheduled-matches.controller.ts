import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, HttpCode,
} from '@nestjs/common';
import { IsString, MinLength, IsNumber, Min, IsArray, IsDateString, IsIn } from 'class-validator';
import { ScheduledMatchesService } from './scheduled-matches.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';

class CreateScheduledMatchDto {
  @IsIn(['chess', 'poker']) gameType: string;
  @IsDateString() scheduledAt: string;
  @IsNumber() @Min(0) stakeAmount: number;
  @IsArray() @IsString({ each: true }) agentIds: string[];
}

@Controller('scheduled-matches')
export class ScheduledMatchesController {
  constructor(private readonly service: ScheduledMatchesService) {}

  /** Public — list upcoming scheduled matches */
  @Get()
  async list(@Query('gameType') gameType?: string) {
    const matches = await this.service.findUpcoming(gameType);
    return { matches };
  }

  /** Auth — create a scheduled match */
  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthPayload,
    @Body() dto: CreateScheduledMatchDto,
  ) {
    const match = await this.service.create({
      gameType: dto.gameType,
      scheduledAt: new Date(dto.scheduledAt),
      stakeAmount: dto.stakeAmount,
      agentIds: dto.agentIds,
      userId: user.userId,
    });
    return { match };
  }

  /** Auth — cancel a scheduled match */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async cancel(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
  ) {
    await this.service.cancel(id, user.userId);
    return { message: 'Scheduled match cancelled' };
  }
}
