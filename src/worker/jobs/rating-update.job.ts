import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent } from '../../database/schemas';

@Injectable()
export class RatingUpdateJob {
  private readonly logger = new Logger(RatingUpdateJob.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  async run(): Promise<void> {
    const agents = await this.agentModel.find({}, {
      'stats.wins': 1,
      'stats.totalMatches': 1,
      'stats.winRate': 1,
    });

    if (agents.length === 0) {
      this.logger.log('No agents found for rating update');
      return;
    }

    const bulkOps: any[] = [];

    for (const agent of agents) {
      const { wins, totalMatches, winRate: storedWinRate } = agent.stats;
      const computedWinRate = totalMatches > 0 ? wins / totalMatches : 0;
      const roundedWinRate = Math.round(computedWinRate * 10000) / 10000;

      if (roundedWinRate !== storedWinRate) {
        bulkOps.push({
          updateOne: {
            filter: { _id: agent._id },
            update: { $set: { 'stats.winRate': roundedWinRate } },
          },
        });
      }
    }

    if (bulkOps.length === 0) {
      this.logger.log('All agent win rates are up to date');
      return;
    }

    const result = await this.agentModel.bulkWrite(bulkOps);
    this.logger.log(`Updated win rates for ${result.modifiedCount} agent(s)`);
  }
}
