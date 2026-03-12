import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduledMatch, ScheduledMatchSchema, Agent, AgentSchema, Match, MatchSchema } from '../database/schemas';
import { AuthModule } from '../auth/auth.module';
import { ScheduledMatchesController } from './scheduled-matches.controller';
import { ScheduledMatchesService } from './scheduled-matches.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScheduledMatch.name, schema: ScheduledMatchSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Match.name, schema: MatchSchema },
    ]),
    AuthModule,
  ],
  controllers: [ScheduledMatchesController],
  providers: [ScheduledMatchesService],
  exports: [ScheduledMatchesService],
})
export class ScheduledMatchesModule {}
