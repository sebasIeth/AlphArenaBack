import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'bets' })
export class Bet extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Match', required: true })
  matchId: Types.ObjectId;

  @Prop({ required: true })
  walletAddress: string;

  @Prop({ required: true })
  onAgentA: boolean;

  @Prop({ required: true })
  amount: number;

  @Prop({ type: String, enum: ['base', 'celo'], default: 'base' })
  chain: string;

  @Prop({ required: true })
  txHash: string;

  createdAt: Date;
  updatedAt: Date;
}

export const BetSchema = SchemaFactory.createForClass(Bet);
BetSchema.index({ userId: 1, matchId: 1 });
BetSchema.index({ userId: 1, createdAt: -1 });
