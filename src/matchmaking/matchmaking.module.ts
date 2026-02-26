import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingQueue } from './matchmaking.queue';
import { AutoPlayService } from './auto-play.service';
import { Agent, AgentSchema, Match, MatchSchema, QueueEntry, QueueEntrySchema } from '../database/schemas';
import { AuthModule } from '../auth/auth.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: Match.name, schema: MatchSchema },
      { name: QueueEntry.name, schema: QueueEntrySchema },
    ]),
    AuthModule,
    forwardRef(() => OrchestratorModule),
  ],
  controllers: [MatchmakingController],
  providers: [MatchmakingService, MatchmakingQueue, AutoPlayService],
  exports: [MatchmakingService, MatchmakingQueue, AutoPlayService],
})
export class MatchmakingModule {}
