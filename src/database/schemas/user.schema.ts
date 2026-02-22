import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true, collection: 'users', toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class User extends Document {
  @Prop({ required: true, unique: true, index: true })
  walletAddress: string;

  @Prop({ required: true, unique: true, index: true })
  username: string;

  @Prop({ type: String, unique: true, sparse: true, default: null })
  email: string | null;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ default: 0 })
  balance: number;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
