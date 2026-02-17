import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface IMove extends Document {
  matchId: Types.ObjectId;
  agentId: Types.ObjectId;
  side: "a" | "b";
  moveNumber: number;
  moveData: { row: number; col: number };
  boardStateAfter: number[][];
  scoreAfter: { a: number; b: number };
  thinkingTimeMs: number;
  timestamp: Date;
}

const moveSchema = new Schema<IMove>(
  {
    matchId: {
      type: Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: "Agent",
      required: true,
    },
    side: {
      type: String,
      enum: ["a", "b"],
      required: true,
    },
    moveNumber: {
      type: Number,
      required: true,
    },
    moveData: {
      row: { type: Number, required: true },
      col: { type: Number, required: true },
    },
    boardStateAfter: {
      type: [[Number]],
      required: true,
    },
    scoreAfter: {
      a: { type: Number, required: true },
      b: { type: Number, required: true },
    },
    thinkingTimeMs: {
      type: Number,
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "moves",
  }
);

moveSchema.index({ matchId: 1, moveNumber: 1 }, { unique: true });

export const MoveModel: Model<IMove> = mongoose.model<IMove>("Move", moveSchema);
