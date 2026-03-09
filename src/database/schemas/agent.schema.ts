import { Prop, Schema, SchemaFactory, raw } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { encrypt, decrypt } from '../../common/crypto.util';

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
    enum: ['http', 'openclaw', 'human'],
    default: 'http',
  })
  type: string;

  @Prop({ required: false })
  endpointUrl: string;

  @Prop({ required: false })
  openclawUrl: string;

  @Prop({ required: false, set: (v: string) => v ? encrypt(v) : v, get: (v: string) => v ? decrypt(v) : v })
  openclawToken: string;

  @Prop({ default: 'main' })
  openclawAgentId: string;

@Prop({ required: false })
  selfclawPublicKey: string;

  @Prop({ type: String, enum: ['base', 'celo'], default: 'base' })
  chain: string;

  @Prop({ required: false, index: true })
  walletAddress: string;

  @Prop({ required: false, select: false, set: (v: string) => v ? encrypt(v) : v, get: (v: string) => v ? decrypt(v) : v })
  walletPrivateKey: string;

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

  @Prop({ type: [String], default: ['chess', 'poker'] })
  gameTypes: string[];

  @Prop({ default: false })
  autoPlay: boolean;

  @Prop({ default: 0 })
  autoPlayStakeAmount: number;

  @Prop({ default: 0 })
  autoPlayConsecutiveErrors: number;

  createdAt: Date;
  updatedAt: Date;
}

export const AgentSchema = SchemaFactory.createForClass(Agent);
AgentSchema.index({ eloRating: 1, status: 1 });
AgentSchema.index({ 'stats.winRate': -1 });
