import mongoose, { Schema, Document, Model, Types } from "mongoose";

export type QueueEntryStatus = "waiting" | "pairing";

export interface IQueueEntry extends Document {
  agentId: Types.ObjectId;
  userId: Types.ObjectId;
  eloRating: number;
  stakeAmount: number;
  gameType: string;
  status: QueueEntryStatus;
  joinedAt: Date;
}

const queueEntrySchema = new Schema<IQueueEntry>(
  {
    agentId: {
      type: Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    eloRating: {
      type: Number,
      required: true,
    },
    stakeAmount: {
      type: Number,
      required: true,
    },
    gameType: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["waiting", "pairing"],
      default: "waiting",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "queue_entries",
  }
);

queueEntrySchema.index({ agentId: 1 }, { unique: true });
queueEntrySchema.index({ eloRating: 1, gameType: 1, status: 1 });

export const QueueEntryModel: Model<IQueueEntry> = mongoose.model<IQueueEntry>(
  "QueueEntry",
  queueEntrySchema
);
