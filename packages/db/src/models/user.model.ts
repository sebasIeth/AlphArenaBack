import mongoose, { Schema, Document, Model } from "mongoose";

export interface IUser extends Document {
  walletAddress: string;
  username: string;
  email: string | null;
  passwordHash: string;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    balance: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "users",
  }
);

export const UserModel: Model<IUser> = mongoose.model<IUser>("User", userSchema);
