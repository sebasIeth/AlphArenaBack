import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { Match, MatchSchema, MoveDoc, MoveSchema, Agent, AgentSchema } from '../database/schemas';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    RealtimeModule,
    MongooseModule.forFeature([
      { name: Match.name, schema: MatchSchema },
      { name: MoveDoc.name, schema: MoveSchema, collection: 'moves' },
      { name: Agent.name, schema: AgentSchema },
    ]),
  ],
  controllers: [MatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
