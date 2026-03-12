import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bet, BetSchema, Match, MatchSchema, User, UserSchema } from '../database/schemas';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { AuthModule } from '../auth/auth.module';
import { BettingController } from './betting.controller';
import { BettingService } from './betting.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bet.name, schema: BetSchema },
      { name: Match.name, schema: MatchSchema },
      { name: User.name, schema: UserSchema },
    ]),
    OrchestratorModule,
    AuthModule,
  ],
  controllers: [BettingController],
  providers: [BettingService],
  exports: [BettingService],
})
export class BettingModule {}
