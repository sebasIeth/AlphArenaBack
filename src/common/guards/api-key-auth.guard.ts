import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { Agent } from '../../database/schemas';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header. Expected: Bearer <apiKey>',
      );
    }

    const apiKey = authHeader.slice(7);
    if (!apiKey.startsWith('ak_')) {
      throw new UnauthorizedException('Invalid API key format. Expected: ak_...');
    }

    const hash = createHash('sha256').update(apiKey).digest('hex');
    const agent = await this.agentModel.findOne({ apiKeyHash: hash });

    if (!agent) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (agent.status === 'disabled') {
      throw new UnauthorizedException('Agent is disabled');
    }

    request.agent = agent;
    return true;
  }
}
