import { Module } from '@nestjs/common';
import { ConfigModule } from '../common/config/config.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { RealtimeGateway } from './realtime.gateway';
import { RoomsService } from './rooms.service';
import { BroadcasterService } from './broadcaster.service';

@Module({
  imports: [ConfigModule, OrchestratorModule],
  providers: [RoomsService, BroadcasterService, RealtimeGateway],
  exports: [RoomsService],
})
export class RealtimeModule {}
