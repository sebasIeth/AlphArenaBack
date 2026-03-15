import { Controller, Post, Get, Body, Param, Query, UseGuards, BadRequestException, ForbiddenException, NotFoundException, HttpCode, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MatchmakingService } from './matchmaking.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';
import { Agent, Match } from '../database/schemas';
import { IsString, MinLength, IsNumber, Min, Max, IsIn } from 'class-validator';
import { MIN_STAKE, MAX_STAKE } from '../common/constants/game.constants';
import { SettlementService } from '../settlement/settlement.service';

class JoinQueueDto {
  @IsString() @MinLength(1) agentId: string;
  @IsNumber() @Min(MIN_STAKE) @Max(MAX_STAKE) stakeAmount: number;
  @IsIn(['marrakech', 'chess', 'poker']) gameType: string;
}

class CancelQueueDto {
  @IsString() @MinLength(1) agentId: string;
}

@Controller('matchmaking')
@UseGuards(JwtAuthGuard)
export class MatchmakingController {
  constructor(
    private readonly matchmakingService: MatchmakingService,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    private readonly settlement: SettlementService,
  ) {}

  @Post('join')
  @HttpCode(201)
  async join(@CurrentUser() user: AuthPayload, @Body() dto: JoinQueueDto) {
    const agent = await this.agentModel.findById(dto.agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new ForbiddenException('You do not own this agent');
    if (agent.status !== 'idle') throw new BadRequestException(`Agent cannot join queue because its status is "${agent.status}". It must be "idle".`);
    if (!agent.gameTypes.includes(dto.gameType)) throw new BadRequestException(`Agent does not support game type "${dto.gameType}".`);
    if (!agent.walletAddress) throw new BadRequestException('Agent does not have a wallet. Please recreate the agent.');

    // Verify agent wallet has sufficient on-chain balance
    const [usdcBalance, ethBalance] = await Promise.all([
      this.settlement.getAgentUsdcBalance(agent.walletAddress),
      this.settlement.getAgentEthBalance(agent.walletAddress),
    ]);

    if (parseFloat(usdcBalance) < dto.stakeAmount) {
      throw new BadRequestException(
        `Insufficient USDC balance. Agent has ${usdcBalance} USDC but needs ${dto.stakeAmount}. Deposit USDC to ${agent.walletAddress}`,
      );
    }

    if (parseFloat(ethBalance) < 0.0001) {
      throw new BadRequestException(
        `Insufficient ETH for gas. Agent has ${ethBalance} ETH but needs at least 0.0001. Deposit ETH to ${agent.walletAddress}`,
      );
    }

    agent.status = 'queued';
    await agent.save();

    try {
      await this.matchmakingService.joinQueue(dto.agentId, user.userId, agent.eloRating, dto.stakeAmount, dto.gameType, agent.type);
      return { message: 'Successfully joined the matchmaking queue', agentId: dto.agentId, gameType: dto.gameType, stakeAmount: dto.stakeAmount };
    } catch (err) {
      agent.status = 'idle';
      await agent.save();
      throw new InternalServerErrorException(err instanceof Error ? err.message : 'Failed to join queue');
    }
  }

  @Post('cancel')
  async cancel(@CurrentUser() user: AuthPayload, @Body() dto: CancelQueueDto) {
    const agent = await this.agentModel.findById(dto.agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new ForbiddenException('You do not own this agent');
    if (agent.status !== 'queued') throw new BadRequestException(`Agent is not in the queue (current status: "${agent.status}")`);

    await this.matchmakingService.leaveQueue(dto.agentId);
    agent.status = 'idle';
    await agent.save();
    return { message: 'Successfully left the matchmaking queue', agentId: dto.agentId };
  }

  @Get('status/:agentId')
  async status(@CurrentUser() user: AuthPayload, @Param('agentId') agentId: string) {
    const agent = await this.agentModel.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new ForbiddenException('You do not own this agent');

    const queueEntry = await this.matchmakingService.getQueueStatus(agentId);

    if (!queueEntry) {
      // Agent is not in queue — check if it's in an active match
      if (agent.status === 'in_match') {
        const activeMatch = await this.matchModel.findOne({
          $or: [{ 'agents.a.agentId': agentId }, { 'agents.b.agentId': agentId }],
          status: { $in: ['starting', 'active'] },
        }).select('_id gameType status').lean();

        if (activeMatch) {
          return { inQueue: false, agentId, agentStatus: agent.status, matchId: (activeMatch as any)._id.toString(), matchStatus: activeMatch.status, gameType: activeMatch.gameType };
        }
      }
      return { inQueue: false, agentId, agentStatus: agent.status };
    }

    return {
      inQueue: true, agentId, agentStatus: agent.status,
      queueEntry: { gameType: queueEntry.gameType, stakeAmount: queueEntry.stakeAmount, eloRating: queueEntry.eloRating, status: queueEntry.status, joinedAt: queueEntry.joinedAt },
    };
  }

  @Get('queue-size')
  async queueSize(@Query('gameType') gameType?: string) {
    const size = await this.matchmakingService.getQueueSize(gameType);
    return { queueSize: size, gameType: gameType ?? 'all' };
  }

  @Get('queue')
  async queue(@Query('gameType') gameType?: string) {
    const entries = this.matchmakingService.getQueueEntries(gameType);
    return {
      queue: entries.map((e) => ({
        agentId: e.agentId,
        eloRating: e.eloRating,
        gameType: e.gameType,
        stakeAmount: e.stakeAmount,
        status: e.status,
        joinedAt: e.joinedAt,
      })),
      total: entries.length,
      gameType: gameType ?? 'all',
    };
  }

  @Get('playing-count')
  async playingCount() {
    const count = await this.agentModel.countDocuments({ status: 'in_match' });
    return { playingCount: count };
  }

  @Get('auto-play-count')
  async autoPlayCount() {
    const count = await this.agentModel.countDocuments({ autoPlay: true });
    return { autoPlayCount: count };
  }
}
