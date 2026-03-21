import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, HttpCode, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsString, MinLength, IsUrl, IsOptional, IsNumber, Min } from 'class-validator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';
import { SettlementRouterService } from '../settlement/settlement-router.service';
import { Agent, User } from '../database/schemas';
import { decrypt } from '../common/crypto.util';

class TestConnectionDto {
  @IsString()
  @MinLength(1, { message: 'OpenClaw URL is required' })
  openclawUrl: string;

  @IsString()
  @MinLength(1, { message: 'OpenClaw token is required' })
  openclawToken: string;
}

class TestWebhookDto {
  @IsString()
  @MinLength(1, { message: 'OpenClaw URL is required' })
  openclawUrl: string;

  @IsString()
  @MinLength(1, { message: 'OpenClaw token is required' })
  openclawToken: string;
}

class ChatMessageDto {
  @IsString()
  @MinLength(1, { message: 'Message is required' })
  message: string;
}

class WithdrawDto {
  @IsNumber()
  @Min(0.01, { message: 'Minimum withdrawal is 0.01 USDC' })
  amount: number;
}

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly settlementRouter: SettlementRouterService,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  @Post('test-connection')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.agentsService.testOpenClawConnection(
      dto.openclawUrl,
      dto.openclawToken,
    );
  }

  @Post('test-webhook')
  testWebhook(@Body() dto: TestWebhookDto) {
    return this.agentsService.testOpenClawWebhook(
      dto.openclawUrl,
      dto.openclawToken,
    );
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreateAgentDto) {
    return this.agentsService.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthPayload) {
    return this.agentsService.findAllByUser(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.findById(id, user.userId);
  }

  @Get(':id/health')
  healthCheck(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.healthCheck(id, user.userId);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthPayload, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(id, user.userId, dto);
  }

  @Post(':id/chat')
  chat(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body() dto: ChatMessageDto,
  ) {
    return this.agentsService.chatWithAgent(id, user.userId, dto.message);
  }

  @Get(':id/balance')
  async getBalance(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new ForbiddenException('You do not own this agent');
    if (!agent.walletAddress) throw new BadRequestException('Agent does not have a wallet');

    const chain = agent.chain || 'solana';
    const [alpha, usdc, eth] = await Promise.all([
      this.settlementRouter.getAgentTokenBalance(chain, agent.walletAddress, 'ALPHA'),
      this.settlementRouter.getAgentTokenBalance(chain, agent.walletAddress, 'USDC'),
      this.settlementRouter.getAgentNativeBalance(chain, agent.walletAddress),
    ]);

    return { walletAddress: agent.walletAddress, alpha, usdc, eth, chain };
  }

  @Post(':id/withdraw')
  async withdraw(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body() dto: WithdrawDto,
  ) {
    const agent = await this.agentModel.findById(id).select('+walletPrivateKey');
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== user.userId) throw new ForbiddenException('You do not own this agent');
    if (!agent.walletAddress || !agent.walletPrivateKey) throw new BadRequestException('Agent does not have a wallet');

    const userDoc = await this.userModel.findById(user.userId);
    if (!userDoc?.walletAddress) throw new BadRequestException('User does not have a wallet address');

    const chain = agent.chain || 'solana';
    const decimals = this.settlementRouter.getTokenDecimals(chain);
    const amountToken = BigInt(Math.round(dto.amount * 10 ** decimals));
    const privKey = decrypt(agent.walletPrivateKey);

    const txHash = await this.settlementRouter.transferTokenFromAgent(chain, privKey, userDoc.walletAddress, amountToken);
    return { txHash, amount: dto.amount, to: userDoc.walletAddress, chain };
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.remove(id, user.userId);
  }
}
