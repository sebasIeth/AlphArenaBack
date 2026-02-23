import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ _id: false })
export class AgentStatsSubDoc {
  @Prop({ default: 0 })
  wins: number;

  @Prop({ default: 0 })
  losses: number;

  @Prop({ default: 0 })
  draws: number;

  @Prop({ default: 0 })
  totalMatches: number;

  @Prop({ default: 0 })
  winRate: number;

  @Prop({ default: 0 })
  totalEarnings: number;
}

export const AgentStatsSubDocSchema = SchemaFactory.createForClass(AgentStatsSubDoc);

@Schema({ timestamps: true, collection: 'agents', toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class Agent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({
    type: String,
    enum: ['http', 'openclaw'],
    default: 'http',
  })
  type: string;

  @Prop({ required: false })
  endpointUrl: string;

  @Prop({ required: false })
  openclawUrl: string;

  @Prop({ required: false })
  openclawToken: string;

  @Prop({ default: 'main' })
  openclawAgentId: string;

  @Prop({ default: 1200, index: true })
  eloRating: number;

  @Prop({
    type: AgentStatsSubDocSchema,
    default: () => ({
      wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0,
    }),
  })
  stats: AgentStatsSubDoc;

  @Prop({
    type: String,
    enum: ['idle', 'queued', 'in_match', 'disabled'],
    default: 'idle',
  })
  status: string;

  @Prop({ type: [String], default: ['reversi'] })
  gameTypes: string[];

  createdAt: Date;
  updatedAt: Date;
}

export const AgentSchema = SchemaFactory.createForClass(Agent);
AgentSchema.index({ eloRating: 1, status: 1 });
AgentSchema.index({ 'stats.winRate': -1 });
