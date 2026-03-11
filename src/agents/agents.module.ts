import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentsController } from './agents.controller';
import { AgentPollController } from './agent-poll.controller';
import { AgentPollDevTestController } from './agent-poll-dev-test.controller';
import { AgentsService } from './agents.service';
import { Agent, AgentSchema, User, UserSchema } from '../database/schemas';
import { AuthModule } from '../auth/auth.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { AgentApiKeyGuard } from '../common/guards/agent-api-key.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
    forwardRef(() => MatchmakingModule),
    forwardRef(() => OrchestratorModule),
  ],
  controllers: [AgentsController, AgentPollController, AgentPollDevTestController],
  providers: [AgentsService, AgentApiKeyGuard],
  exports: [AgentsService],
})
export class AgentsModule {}
