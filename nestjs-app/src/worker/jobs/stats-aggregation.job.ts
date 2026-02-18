import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Match, Agent } from '../../database/schemas';

interface AggregatedAgentStats {
  _id: Types.ObjectId;
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  totalEarnings: number;
}

@Injectable()
export class StatsAggregationJob {
  private readonly logger = new Logger(StatsAggregationJob.name);

  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  async run(): Promise<void> {
    const pipeline = [
      { $match: { status: 'completed', result: { $ne: null } } },
      {
        $facet: {
          sideA: [
            {
              $project: {
                agentId: '$agents.a.agentId',
                isWinner: {
                  $cond: [{ $eq: ['$result.winnerId', '$agents.a.agentId'] }, true, false],
                },
                isDraw: { $eq: ['$result.reason', 'draw'] },
                earnings: {
                  $cond: [{ $eq: ['$result.winnerId', '$agents.a.agentId'] }, '$potAmount', 0],
                },
              },
            },
          ],
          sideB: [
            {
              $project: {
                agentId: '$agents.b.agentId',
                isWinner: {
                  $cond: [{ $eq: ['$result.winnerId', '$agents.b.agentId'] }, true, false],
                },
                isDraw: { $eq: ['$result.reason', 'draw'] },
                earnings: {
                  $cond: [{ $eq: ['$result.winnerId', '$agents.b.agentId'] }, '$potAmount', 0],
                },
              },
            },
          ],
        },
      },
      { $project: { allSides: { $concatArrays: ['$sideA', '$sideB'] } } },
      { $unwind: '$allSides' },
      { $replaceRoot: { newRoot: '$allSides' } },
      {
        $group: {
          _id: '$agentId',
          totalMatches: { $sum: 1 },
          wins: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$isWinner', true] }, { $eq: ['$isDraw', false] }] }, 1, 0],
            },
          },
          losses: {
            $sum: {
              $cond: [{ $and: [{ $eq: ['$isWinner', false] }, { $eq: ['$isDraw', false] }] }, 1, 0],
            },
          },
          draws: {
            $sum: { $cond: [{ $eq: ['$isDraw', true] }, 1, 0] },
          },
          totalEarnings: { $sum: '$earnings' },
        },
      },
    ];

    const results = (await this.matchModel.aggregate(pipeline)) as AggregatedAgentStats[];

    if (results.length === 0) {
      this.logger.log('No completed matches found for stats aggregation');
      return;
    }

    const bulkOps = results.map((stat) => {
      const winRate = stat.totalMatches > 0
        ? Math.round((stat.wins / stat.totalMatches) * 10000) / 10000
        : 0;

      return {
        updateOne: {
          filter: { _id: stat._id },
          update: {
            $set: {
              'stats.wins': stat.wins,
              'stats.losses': stat.losses,
              'stats.draws': stat.draws,
              'stats.totalMatches': stat.totalMatches,
              'stats.winRate': winRate,
              'stats.totalEarnings': stat.totalEarnings,
            },
          },
        },
      };
    });

    const bulkResult = await this.agentModel.bulkWrite(bulkOps);
    this.logger.log(
      `Aggregated stats for ${results.length} agent(s), updated ${bulkResult.modifiedCount}`,
    );
  }
}
