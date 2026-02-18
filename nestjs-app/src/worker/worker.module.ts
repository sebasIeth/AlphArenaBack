import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Match, MatchSchema, Agent, AgentSchema } from '../database/schemas';
import { WorkerService } from './worker.service';
import { MatchCleanupJob } from './jobs/match-cleanup.job';
import { RatingUpdateJob } from './jobs/rating-update.job';
import { StatsAggregationJob } from './jobs/stats-aggregation.job';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Match.name, schema: MatchSchema },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  providers: [
    MatchCleanupJob,
    RatingUpdateJob,
    StatsAggregationJob,
    WorkerService,
  ],
})
export class WorkerModule {}
