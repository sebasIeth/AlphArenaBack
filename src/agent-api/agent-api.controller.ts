import {
  Controller, Post, Get, Body, Param, UseGuards, HttpCode, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyAuthGuard } from '../common/guards/api-key-auth.guard';
import { CurrentAgent } from '../common/decorators/current-agent.decorator';
import { Agent } from '../database/schemas';
import { SettlementService } from '../settlement/settlement.service';
import { AgentApiService } from './agent-api.service';
import { HeartbeatService } from './heartbeat.service';
import { RegisterAgentDto } from './dto/register.dto';
import { JoinQueueDto } from './dto/queue.dto';
import { SubmitMoveDto } from './dto/move.dto';

@Controller('v1')
export class AgentApiController {
  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly agentApiService: AgentApiService,
    private readonly heartbeatService: HeartbeatService,
    private readonly settlement: SettlementService,
  ) {}

  @Post('register')
  @SkipThrottle()
  async register(@Body() dto: RegisterAgentDto) {
    return this.agentApiService.registerAgent(dto);
  }

  @Get('status')
  @UseGuards(ApiKeyAuthGuard)
  async status(@CurrentAgent() agent: Agent) {
    return this.agentApiService.getAgentStatus(agent);
  }

  @Post('queue/join')
  @UseGuards(ApiKeyAuthGuard)
  @HttpCode(200)
  async joinQueue(@CurrentAgent() agent: Agent, @Body() dto: JoinQueueDto) {
    return this.agentApiService.joinQueue(agent, dto);
  }

  @Post('queue/leave')
  @UseGuards(ApiKeyAuthGuard)
  @HttpCode(200)
  async leaveQueue(@CurrentAgent() agent: Agent) {
    return this.agentApiService.leaveQueue(agent);
  }

  @Post('heartbeat')
  @UseGuards(ApiKeyAuthGuard)
  @SkipThrottle()
  @HttpCode(200)
  async heartbeat(@CurrentAgent() agent: Agent) {
    return this.heartbeatService.heartbeat(agent);
  }

  @Get('games/:matchId')
  @UseGuards(ApiKeyAuthGuard)
  async getGameState(
    @CurrentAgent() agent: Agent,
    @Param('matchId') matchId: string,
  ) {
    return this.agentApiService.getGameState(agent, matchId);
  }

  @Post('games/:matchId/moves')
  @UseGuards(ApiKeyAuthGuard)
  @HttpCode(200)
  async submitMove(
    @CurrentAgent() agent: Agent,
    @Param('matchId') matchId: string,
    @Body() dto: SubmitMoveDto,
  ) {
    return this.agentApiService.submitMove(agent, matchId, dto);
  }

  @Get('wallet')
  @UseGuards(ApiKeyAuthGuard)
  async getWallet(@CurrentAgent() agent: Agent) {
    if (!agent.walletAddress) {
      throw new BadRequestException('Agent does not have a wallet');
    }

    const [usdc, eth] = await Promise.all([
      this.settlement.getAgentUsdcBalance(agent.walletAddress),
      this.settlement.getAgentEthBalance(agent.walletAddress),
    ]);

    return {
      agentId: (agent as any)._id.toString(),
      walletAddress: agent.walletAddress,
      balances: { usdc, eth },
      depositAddress: agent.walletAddress,
    };
  }
}
