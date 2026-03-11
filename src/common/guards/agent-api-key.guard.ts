import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from '../../database/schemas';

@Injectable()
export class AgentApiKeyGuard implements CanActivate {
  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const apiKey =
      request.headers['x-agent-api-key'] ||
      this.extractBearerKey(request.headers.authorization);

    if (!apiKey) {
      throw new UnauthorizedException(
        'Missing agent API key. Use header X-Agent-Api-Key or Authorization: Bearer agent_<key>',
      );
    }

    const agent = await this.agentModel.findOne({ pollingApiKey: apiKey });
    if (!agent) {
      throw new UnauthorizedException('Invalid agent API key');
    }

    if (agent.status === ('disabled' as string)) {
      throw new UnauthorizedException('Agent is disabled');
    }

    request.agent = agent;
    return true;
  }

  private extractBearerKey(header?: string): string | null {
    if (!header || !header.startsWith('Bearer agent_')) return null;
    return header.slice(7); // "Bearer " = 7 chars, keeps "agent_<key>"
  }
}
