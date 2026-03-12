import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class ScheduledMatchAgent {
  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true })
  agentId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  elo: number;

  @Prop({ required: true })
  color: string;
}

export const ScheduledMatchAgentSchema = SchemaFactory.createForClass(ScheduledMatchAgent);

@Schema({
  timestamps: true,
  collection: 'scheduled_matches',
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class ScheduledMatch extends Document {
  @Prop({ required: true })
  gameType: string;

  @Prop({ type: Date, required: true, index: true })
  scheduledAt: Date;

  @Prop({
    type: String,
    enum: ['scheduled', 'starting', 'completed', 'cancelled'],
    default: 'scheduled',
    index: true,
  })
  status: string;

  @Prop({ required: true })
  stakeAmount: number;

  @Prop({ type: [ScheduledMatchAgentSchema], required: true })
  agents: ScheduledMatchAgent[];

  @Prop({ type: String, default: null })
  matchId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: String, default: null })
  cancelReason: string;

  createdAt: Date;
  updatedAt: Date;
}

export const ScheduledMatchSchema = SchemaFactory.createForClass(ScheduledMatch);

ScheduledMatchSchema.index({ status: 1, scheduledAt: 1 });
