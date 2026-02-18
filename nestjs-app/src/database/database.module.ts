import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  User, UserSchema,
  Agent, AgentSchema,
  Match, MatchSchema,
  MoveDoc, MoveSchema,
  Transaction, TransactionSchema,
  QueueEntry, QueueEntrySchema,
} from './schemas';

const schemas = MongooseModule.forFeature([
  { name: User.name, schema: UserSchema },
  { name: Agent.name, schema: AgentSchema },
  { name: Match.name, schema: MatchSchema },
  { name: MoveDoc.name, schema: MoveSchema },
  { name: Transaction.name, schema: TransactionSchema },
  { name: QueueEntry.name, schema: QueueEntrySchema },
]);

@Global()
@Module({
  imports: [schemas],
  exports: [schemas],
})
export class DatabaseModule {}
