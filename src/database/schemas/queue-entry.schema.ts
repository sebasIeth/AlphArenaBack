import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'queue_entries', toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class QueueEntry extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true, unique: true })
  agentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  eloRating: number;

  @Prop({ required: true })
  stakeAmount: number;

  @Prop({ required: true })
  gameType: string;

  @Prop({ type: String, enum: ['waiting', 'pairing'], default: 'waiting' })
  status: string;

  @Prop({ required: false })
  agentType: string;

  @Prop({ default: Date.now })
  joinedAt: Date;
}

export const QueueEntrySchema = SchemaFactory.createForClass(QueueEntry);
QueueEntrySchema.index({ eloRating: 1, gameType: 1, status: 1 });
