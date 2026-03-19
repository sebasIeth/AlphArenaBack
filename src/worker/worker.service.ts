import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MatchCleanupJob } from './jobs/match-cleanup.job';
import { RatingUpdateJob } from './jobs/rating-update.job';
import { StatsAggregationJob } from './jobs/stats-aggregation.job';
import { ScheduledMatchJob } from './jobs/scheduled-match.job';
import { RandomScheduledMatchJob } from './jobs/random-scheduled-match.job';

@Injectable()
export class WorkerService {
  private readonly logger = new Logger(WorkerService.name);

  constructor(
    private readonly matchCleanup: MatchCleanupJob,
    private readonly ratingUpdate: RatingUpdateJob,
    private readonly statsAggregation: StatsAggregationJob,
    private readonly scheduledMatch: ScheduledMatchJob,
    private readonly randomScheduledMatch: RandomScheduledMatchJob,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleMatchCleanup(): Promise<void> {
    this.logger.log('Running match cleanup job');
    try {
      await this.matchCleanup.run();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Match cleanup job failed: ${message}`);
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleRatingUpdate(): Promise<void> {
    this.logger.log('Running rating update job');
    try {
      await this.ratingUpdate.run();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rating update job failed: ${message}`);
    }
  }

  @Cron('0 */15 * * * *')
  async handleStatsAggregation(): Promise<void> {
    this.logger.log('Running stats aggregation job');
    try {
      await this.statsAggregation.run();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Stats aggregation job failed: ${message}`);
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleScheduledMatches(): Promise<void> {
    try {
      await this.scheduledMatch.run();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scheduled match job failed: ${message}`);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleRandomScheduledMatches(): Promise<void> {
    try {
      await this.randomScheduledMatch.run();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Random scheduled match job failed: ${message}`);
    }
  }

}
