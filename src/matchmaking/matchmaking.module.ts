import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingQueue } from './matchmaking.queue';
import { Agent, AgentSchema, QueueEntry, QueueEntrySchema } from '../database/schemas';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: QueueEntry.name, schema: QueueEntrySchema },
    ]),
    AuthModule,
  ],
  controllers: [MatchmakingController],
  providers: [MatchmakingService, MatchmakingQueue],
  exports: [MatchmakingService, MatchmakingQueue],
})
export class MatchmakingModule {}
