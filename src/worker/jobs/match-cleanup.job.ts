import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Match, Agent } from '../../database/schemas';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

@Injectable()
export class MatchCleanupJob {
  private readonly logger = new Logger(MatchCleanupJob.name);

  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const staleMatches = await this.matchModel.find({
      status: { $in: ['starting', 'active'] },
      updatedAt: { $lt: cutoff },
      agents: { $exists: true },
    });

    if (staleMatches.length === 0) {
      this.logger.log('No stale matches found');
      return;
    }

    const staleMatchIds = staleMatches.map((m) => m._id);

    const agentIds = staleMatches.flatMap((m) => [
      m.agents.a.agentId,
      m.agents.b.agentId,
    ]);

    const matchUpdateResult = await this.matchModel.updateMany(
      { _id: { $in: staleMatchIds } },
      {
        $set: {
          status: 'error',
          result: {
            winnerId: null,
            reason: 'disconnect',
            finalScore: { a: 0, b: 0 },
            totalMoves: 0,
            eloChange: { a: 0, b: 0 },
          },
          endedAt: new Date(),
        },
      },
    );

    const agentUpdateResult = await this.agentModel.updateMany(
      {
        _id: { $in: agentIds },
        status: { $in: ['queued', 'in_match'] },
      },
      { $set: { status: 'idle' } },
    );

    this.logger.log(
      `Cleaned up ${matchUpdateResult.modifiedCount} stale match(es), reset ${agentUpdateResult.modifiedCount} agent(s)`,
    );
  }
}
