import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from '../database/schemas';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { DEFAULT_ELO } from '../common/constants/game.constants';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(@InjectModel(Agent.name) private readonly agentModel: Model<Agent>) {}

  async create(userId: string, dto: CreateAgentDto) {
    const existing = await this.agentModel.findOne({
      userId, name: dto.name, status: { $ne: 'disabled' },
    });
    if (existing) {
      throw new ConflictException('You already have an agent with this name');
    }

    const agent = await this.agentModel.create({
      userId,
      name: dto.name,
      endpointUrl: dto.endpointUrl,
      gameTypes: dto.gameTypes,
      eloRating: DEFAULT_ELO,
      status: 'idle',
      stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0 },
    });

    this.logger.log(`Agent created: ${dto.name} by user ${userId}`);
    return { agent };
  }

  async findAllByUser(userId: string) {
    const agents = await this.agentModel.find({ userId, status: { $ne: 'disabled' } }).sort({ createdAt: -1 });
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
    if (dto.gameTypes !== undefined) agent.gameTypes = dto.gameTypes;

    await agent.save();
    this.logger.log(`Agent updated: ${id}`);
    return { agent };
  }

  async remove(id: string, userId: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');
    if (agent.status === 'in_match') throw new BadRequestException('Cannot disable an agent that is currently in a match');
    if (agent.status === 'queued') throw new BadRequestException('Cannot disable an agent that is currently in the matchmaking queue. Remove it from the queue first.');

    agent.status = 'disabled';
    await agent.save();
    this.logger.log(`Agent disabled: ${id}`);
    return { message: 'Agent disabled successfully', agent };
  }
}
