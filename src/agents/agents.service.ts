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

    const agentType = dto.type || 'http';

    const agentData: Record<string, unknown> = {
      userId,
      name: dto.name,
      type: agentType,
      gameTypes: dto.gameTypes,
      eloRating: DEFAULT_ELO,
      status: 'idle',
      stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0 },
    };

    if (agentType === 'openclaw') {
      agentData.openclawUrl = dto.openclawUrl;
      agentData.openclawToken = dto.openclawToken;
      agentData.openclawAgentId = dto.openclawAgentId || 'main';
    } else {
      agentData.endpointUrl = dto.endpointUrl;
    }

    const agent = await this.agentModel.create(agentData);

    this.logger.log(`Agent created: ${dto.name} (type=${agentType}) by user ${userId}`);
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
    if (dto.openclawUrl !== undefined) agent.openclawUrl = dto.openclawUrl;
    if (dto.openclawToken !== undefined) agent.openclawToken = dto.openclawToken;
    if (dto.openclawAgentId !== undefined) agent.openclawAgentId = dto.openclawAgentId;
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

  async healthCheck(id: string, userId: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.userId.toString() !== userId) throw new ForbiddenException('You do not own this agent');

    if (agent.type !== 'openclaw') {
      throw new BadRequestException('Health check is only available for OpenClaw agents');
    }

    return this.pingOpenClaw(agent.openclawUrl, agent.openclawToken, agent.openclawAgentId || 'main');
  }

  async testOpenClawConnection(openclawUrl: string, openclawToken: string, openclawAgentId: string) {
    return this.pingOpenClaw(openclawUrl, openclawToken, openclawAgentId);
  }

  async testOpenClawWebhook(openclawUrl: string, hookToken: string) {
    const start = Date.now();
    try {
      const url = `${openclawUrl.replace(/\/$/, '')}/hooks/wake`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hookToken}`,
        },
        body: JSON.stringify({
          text: 'AlphArena health check',
          mode: 'now',
        }),
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${body}` };
      }

      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }

  private async pingOpenClaw(openclawUrl: string, openclawToken: string, openclawAgentId: string) {
    const start = Date.now();
    try {
      const url = `${openclawUrl.replace(/\/$/, '')}/v1/chat/completions`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openclawToken}`,
          'x-openclaw-agent-id': openclawAgentId,
        },
        body: JSON.stringify({
          model: `openclaw:${openclawAgentId}`,
          messages: [
            { role: 'system', content: 'Respond: pong' },
            { role: 'user', content: 'ping' },
          ],
          temperature: 0,
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${body}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return { ok: true, latencyMs, response: content.substring(0, 50) };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }
}
