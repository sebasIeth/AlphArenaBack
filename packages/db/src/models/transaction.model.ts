import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type TransactionType = "stake" | "payout" | "refund" | "platform_fee";
export type TransactionStatus = "pending" | "confirmed" | "failed";

export interface ITransaction extends Document {
  matchId: Types.ObjectId;
  userId: Types.ObjectId;
  type: TransactionType;
  amount: number;
  txHash: string | null;
  status: TransactionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    matchId: {
      type: Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["stake", "payout", "refund", "platform_fee"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    txHash: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "confirmed", "failed"],
      default: "pending",
    },
  },
  {
    timestamps: true,
    collection: "transactions",
  }
);

transactionSchema.index({ matchId: 1 });
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ txHash: 1 }, { sparse: true, unique: true });

export const TransactionModel: Model<ITransaction> = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema
);
