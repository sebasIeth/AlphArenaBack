import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { Agent } from '../database/schemas';
import { ActiveMatchesService } from '../orchestrator/active-matches.service';
import { HumanMoveService } from '../orchestrator/human-move.service';

const DEFAULT_HEARTBEAT_SECONDS = 5;
const IDLE_HEARTBEAT_SECONDS = 15;

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly activeMatches: ActiveMatchesService,
    private readonly humanMoveService: HumanMoveService,
  ) {}

  async heartbeat(agent: Agent) {
    const agentId = (agent as any)._id.toString();

    // Update last heartbeat
    await this.agentModel.updateOne(
      { _id: agentId },
      { lastHeartbeat: new Date() },
    );

    // Find all active matches this agent is in
    const dueGameIds: string[] = [];
    let shouldMoveNow = false;

    for (const [matchId, state] of this.activeMatches.entries()) {
      for (const side of Object.keys(state.agents)) {
        if (state.agents[side].agentId === agentId) {
          // Agent is in this match
          const pendingAgentId = this.humanMoveService.getPendingAgentId(matchId);
          if (pendingAgentId === agentId) {
            dueGameIds.push(matchId);
            shouldMoveNow = true;
          }
          break;
        }
      }
    }

    const recommendedHeartbeatSeconds = shouldMoveNow
      ? DEFAULT_HEARTBEAT_SECONDS
      : agent.status === 'in_match'
        ? DEFAULT_HEARTBEAT_SECONDS
        : IDLE_HEARTBEAT_SECONDS;

    return {
      agentId,
      status: agent.status,
      shouldMoveNow,
      dueGameIds,
      recommendedHeartbeatSeconds,
      timestamp: new Date().toISOString(),
    };
  }

  async batchHeartbeat(apiKeys: string[]) {
    const results: Record<string, unknown> = {};

    for (const apiKey of apiKeys) {
      try {
        const hash = createHash('sha256').update(apiKey).digest('hex');
        const agent = await this.agentModel.findOne({ apiKeyHash: hash });

        if (!agent) {
          results[apiKey.substring(0, 11)] = { error: 'Invalid API key' };
          continue;
        }

        results[(agent as any)._id.toString()] = await this.heartbeat(agent);
      } catch (err) {
        const prefix = apiKey.substring(0, 11);
        results[prefix] = { error: 'Heartbeat failed' };
      }
    }

    return { results };
  }
}
