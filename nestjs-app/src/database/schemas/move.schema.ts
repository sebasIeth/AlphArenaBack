import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'moves' })
export class MoveDoc extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Match', required: true, index: true })
  matchId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true })
  agentId: Types.ObjectId;

  @Prop({ type: String, enum: ['a', 'b'], required: true })
  side: string;

  @Prop({ required: true })
  moveNumber: number;

  @Prop({ type: Object, required: true })
  moveData: { row: number; col: number };

  @Prop({ type: [[Number]], required: true })
  boardStateAfter: number[][];

  @Prop({ type: Object, required: true })
  scoreAfter: { a: number; b: number };

  @Prop({ required: true })
  thinkingTimeMs: number;

  @Prop({ default: Date.now })
  timestamp: Date;
}

export const MoveSchema = SchemaFactory.createForClass(MoveDoc);
MoveSchema.index({ matchId: 1, moveNumber: 1 }, { unique: true });
