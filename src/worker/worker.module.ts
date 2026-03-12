import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Match, MatchSchema, Agent, AgentSchema, ScheduledMatch, ScheduledMatchSchema, Bet, BetSchema } from '../database/schemas';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { WorkerService } from './worker.service';
import { MatchCleanupJob } from './jobs/match-cleanup.job';
import { RatingUpdateJob } from './jobs/rating-update.job';
import { StatsAggregationJob } from './jobs/stats-aggregation.job';
import { ScheduledMatchJob } from './jobs/scheduled-match.job';
import { RandomScheduledMatchJob } from './jobs/random-scheduled-match.job';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Match.name, schema: MatchSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: ScheduledMatch.name, schema: ScheduledMatchSchema },
      { name: Bet.name, schema: BetSchema },
    ]),
    OrchestratorModule,
  ],
  providers: [
    MatchCleanupJob,
    RatingUpdateJob,
    StatsAggregationJob,
    ScheduledMatchJob,
    RandomScheduledMatchJob,
    WorkerService,
  ],
})
export class WorkerModule {}
