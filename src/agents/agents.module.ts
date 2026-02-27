import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { Agent, AgentSchema, User, UserSchema } from '../database/schemas';
import { AuthModule } from '../auth/auth.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
    forwardRef(() => MatchmakingModule),
  ],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
