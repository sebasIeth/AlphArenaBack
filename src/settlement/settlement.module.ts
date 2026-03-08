import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SettlementService } from './settlement.service';
import { BettingController } from './betting.controller';
import { Match, MatchSchema, User, UserSchema } from '../database/schemas';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Match.name, schema: MatchSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BettingController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
