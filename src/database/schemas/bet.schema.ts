import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'bets',
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class Bet extends Document {
  @Prop({ type: String, required: true, index: true })
  matchId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null })
  walletAddress: string;

  /** true = bet on agent A, false = bet on agent B */
  @Prop({ required: true })
  onAgentA: boolean;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ type: String, default: null })
  txHash: string | null;

  @Prop({ default: false })
  claimed: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const BetSchema = SchemaFactory.createForClass(Bet);

BetSchema.index({ matchId: 1, userId: 1 });
BetSchema.index({ userId: 1, claimed: 1 });
