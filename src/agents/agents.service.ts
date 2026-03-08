import { Injectable, Inject, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, User } from '../database/schemas';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { DEFAULT_ELO } from '../common/constants/game.constants';
import { OpenClawWsService } from '../openclaw-ws';
import { AutoPlayService } from '../matchmaking/auto-play.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly openclawWs: OpenClawWsService,
    @Inject(forwardRef(() => AutoPlayService)) private readonly autoPlayService: AutoPlayService,
    @Inject(forwardRef(() => MatchmakingService)) private readonly matchmakingService: MatchmakingService,
  ) {}

  async create(userId: string, dto: CreateAgentDto) {
    const existing = await this.agentModel.findOne({
      userId, name: dto.name, status: { $ne: 'disabled' },
    });
    if (existing) {
      throw new ConflictException('You already have an agent with this name');
    }

    const agentType = dto.type || 'http';

    const agentData: Record<string, unknown> = {
      userId,
      name: dto.name,
      type: agentType,
      chain: dto.chain || 'base',
      gameTypes: dto.gameTypes || ['chess'],
      eloRating: DEFAULT_ELO,
      status: 'idle',
      stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0 },
    };

    if (agentType === 'human') {
      // Human agents use the user's wallet instead of generating a new one
      const user = await this.userModel.findById(userId).select('+walletPrivateKey');
      if (!user || !user.walletAddress) {
        throw new BadRequestException('User does not have a wallet. Please re-register.');
      }
      agentData.walletAddress = user.walletAddress;
      agentData.walletPrivateKey = user.walletPrivateKey;
    } else if (agentType === 'openclaw') {
      agentData.openclawUrl = dto.openclawUrl;
      agentData.openclawToken = dto.openclawToken;
      agentData.openclawAgentId = dto.openclawAgentId || 'main';

      // Generate a dedicated wallet for this agent
      const privKey = generatePrivateKey();
      const account = privateKeyToAccount(privKey);
      agentData.walletAddress = account.address;
      agentData.walletPrivateKey = privKey;
    } else {
      agentData.endpointUrl = dto.endpointUrl;

      // Generate a dedicated wallet for this agent
      const privKey = generatePrivateKey();
      const account = privateKeyToAccount(privKey);
      agentData.walletAddress = account.address;
      agentData.walletPrivateKey = privKey;
    }

    const agent = await this.agentModel.create(agentData);

    this.logger.log(`Agent created: ${dto.name} (type=${agentType}) by user ${userId}`);
    return { agent };
  }

  async findAllByUser(userId: string) {
    const agents = await this.agentModel.find({ userId, status: { $ne: 'disabled' }, type: { $ne: 'human' } }).sort({ createdAt: -1 });
    return { agents };
  }

  async findById(id: string, userId: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');
    return { agent };
  }

  async update(id: string, userId: string, dto: UpdateAgentDto) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');
    if (agent.status === 'disabled') throw new BadRequestException('Cannot update a disabled agent');

    if (dto.name && dto.name !== agent.name) {
      const nameConflict = await this.agentModel.findOne({
        userId, name: dto.name, status: { $ne: 'disabled' }, _id: { $ne: id },
      });
      if (nameConflict) throw new ConflictException('You already have an agent with this name');
    }

    if (dto.name !== undefined) agent.name = dto.name;
    if (dto.endpointUrl !== undefined) agent.endpointUrl = dto.endpointUrl;
    if (dto.openclawUrl !== undefined) agent.openclawUrl = dto.openclawUrl;
    if (dto.openclawToken !== undefined) agent.openclawToken = dto.openclawToken;
    if (dto.openclawAgentId !== undefined) agent.openclawAgentId = dto.openclawAgentId;
    if (dto.gameTypes !== undefined) agent.gameTypes = dto.gameTypes;
    if (dto.autoPlayStakeAmount !== undefined) agent.autoPlayStakeAmount = dto.autoPlayStakeAmount;

    if (dto.autoPlay !== undefined) {
      agent.autoPlay = dto.autoPlay;

      if (dto.autoPlay) {
        // Reset error counter when enabling
        agent.autoPlayConsecutiveErrors = 0;
      }
    }

    await agent.save();

    // Handle auto-play side effects after save
    if (dto.autoPlay === true && agent.status === 'idle') {
      this.autoPlayService.scheduleRequeue(id);
    } else if (dto.autoPlay === false) {
      this.autoPlayService.cancelPendingRequeue(id);
      if (agent.status === 'queued') {
        try {
          await this.matchmakingService.leaveQueue(id);
          agent.status = 'idle';
          await agent.save();
        } catch (error: unknown) {
          this.logger.warn(`Failed to remove agent ${id} from queue on auto-play disable`);
        }
      }
    }

    this.logger.log(`Agent updated: ${id}`);
    return { agent };
  }

  async remove(id: string, userId: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');
    if (agent.status === 'in_match') throw new BadRequestException('Cannot disable an agent that is currently in a match');

    // If agent has auto-play, disable it and cancel pending requeue
    if (agent.autoPlay) {
      agent.autoPlay = false;
      this.autoPlayService.cancelPendingRequeue(id);
    }

    // If queued, remove from queue first
    if (agent.status === 'queued') {
      try {
        await this.matchmakingService.leaveQueue(id);
      } catch {}
    }

    agent.status = 'disabled';
    await agent.save();
    this.logger.log(`Agent disabled: ${id}`);
    return { message: 'Agent disabled successfully', agent };
  }

  async healthCheck(id: string, userId: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');

    if (agent.type !== 'openclaw') {
      throw new BadRequestException('Health check is only available for OpenClaw agents');
    }

    return this.openclawWs.testHealth(agent.openclawUrl, agent.openclawToken);
  }

  async testOpenClawConnection(openclawUrl: string, openclawToken: string) {
    return this.openclawWs.testHealth(openclawUrl, openclawToken);
  }

  async testOpenClawWebhook(openclawUrl: string, openclawToken: string) {
    return this.openclawWs.testWake(openclawUrl, openclawToken);
  }

  async chatWithAgent(id: string, userId: string, message: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');

    if (agent.type !== 'openclaw') {
      throw new BadRequestException('Chat is only available for OpenClaw agents');
    }

    const reply = await this.openclawWs.sendAgentChat(
      agent.openclawUrl,
      agent.openclawToken,
      message,
      agent.openclawAgentId,
    );

    return { reply };
  }
}
