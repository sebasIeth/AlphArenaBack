import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, HttpCode, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { IsString, MinLength, IsUrl, IsOptional, IsNumber, Min, Matches } from 'class-validator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';
import { SettlementService } from '../settlement/settlement.service';
import { Agent, User } from '../database/schemas';
import { decrypt } from '../common/crypto.util';
import { TOKEN_DECIMALS } from '../common/constants/game.constants';

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

  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'Invalid Ethereum address' })
  toAddress?: string;
}

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly settlement: SettlementService,
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

    const [usdc, eth] = await Promise.all([
      this.settlement.getAgentUsdcBalance(agent.walletAddress),
      this.settlement.getAgentEthBalance(agent.walletAddress),
    ]);

    return { walletAddress: agent.walletAddress, usdc, eth };
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

    const toAddress = dto.toAddress ?? (await this.userModel.findById(user.userId))?.walletAddress;
    if (!toAddress) throw new BadRequestException('No destination address. Provide toAddress or set a wallet on your account.');

    const amountUsdc = BigInt(Math.round(dto.amount * 10 ** TOKEN_DECIMALS));
    const privKey = decrypt(agent.walletPrivateKey);

    const txHash = await this.settlement.transferUsdcFromAgent(privKey, toAddress, amountUsdc);
    return { txHash, amount: dto.amount, to: toAddress };
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.remove(id, user.userId);
  }
}
