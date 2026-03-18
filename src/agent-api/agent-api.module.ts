import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agent, AgentSchema, Match, MatchSchema } from '../database/schemas';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { ConfigModule } from '../common/config/config.module';
import { SettlementModule } from '../settlement/settlement.module';
import { AgentApiController } from './agent-api.controller';
import { AgentApiBatchController } from './agent-api-batch.controller';
import { AgentApiPublicController } from './agent-api-public.controller';
import { AgentApiClaimsController } from './agent-api-claims.controller';
import { AgentApiService } from './agent-api.service';
import { HeartbeatService } from './heartbeat.service';
import { ClaimService } from './claim.service';
import { ApiKeyAuthGuard } from '../common/guards/api-key-auth.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: Match.name, schema: MatchSchema },
    ]),
    forwardRef(() => OrchestratorModule),
    forwardRef(() => MatchmakingModule),
    LeaderboardModule,
    ConfigModule,
    forwardRef(() => SettlementModule),
  ],
  controllers: [
    AgentApiController,
    AgentApiBatchController,
    AgentApiPublicController,
    AgentApiClaimsController,
  ],
  providers: [
    AgentApiService,
    HeartbeatService,
    ClaimService,
    ApiKeyAuthGuard,
  ],
})
export class AgentApiModule {}
