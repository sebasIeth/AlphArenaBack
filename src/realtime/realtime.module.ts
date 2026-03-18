import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '../common/config/config.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { RealtimeGateway } from './realtime.gateway';
import { RoomsService } from './rooms.service';
import { BroadcasterService } from './broadcaster.service';
import { Agent, AgentSchema, Match, MatchSchema } from '../database/schemas';

@Module({
  imports: [
    ConfigModule,
    OrchestratorModule,
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: Match.name, schema: MatchSchema },
    ]),
  ],
  providers: [RoomsService, BroadcasterService, RealtimeGateway],
  exports: [RoomsService],
})
export class RealtimeModule {}
