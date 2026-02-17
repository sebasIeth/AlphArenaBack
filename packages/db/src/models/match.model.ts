import mongoose, { Schema, Document, Model, Types } from "mongoose";
import type { MatchStatus, MatchResultReason } from "@alpharena/shared";

export interface IMatchAgent {
  agentId: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  eloAtStart: number;
}

export interface IMatchResult {
  winnerId: Types.ObjectId | null;
  reason: MatchResultReason;
  finalScore: { a: number; b: number };
  totalMoves: number;
  eloChange: { a: number; b: number };
}

export interface IMatch extends Document {
  gameType: string;
  agents: { a: IMatchAgent; b: IMatchAgent };
  stakeAmount: number;
  potAmount: number;
  status: MatchStatus;
  result: IMatchResult | null;
  currentBoard: number[][];
  currentTurn: "a" | "b";
  moveCount: number;
  timeouts: { a: number; b: number };
  txHashes: { escrow: string | null; payout: string | null };
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const matchAgentSchema = new Schema<IMatchAgent>(
  {
    agentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    eloAtStart: { type: Number, required: true },
  },
  { _id: false }
);

const matchResultSchema = new Schema<IMatchResult>(
  {
    winnerId: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
    reason: {
      type: String,
      enum: ["score", "timeout", "forfeit", "disconnect", "draw"],
      required: true,
    },
    finalScore: {
      a: { type: Number, required: true },
      b: { type: Number, required: true },
    },
    totalMoves: { type: Number, required: true },
    eloChange: {
      a: { type: Number, required: true },
      b: { type: Number, required: true },
    },
  },
  { _id: false }
);

const matchSchema = new Schema<IMatch>(
  {
    gameType: {
      type: String,
      required: true,
    },
    agents: {
      a: { type: matchAgentSchema, required: true },
      b: { type: matchAgentSchema, required: true },
    },
    stakeAmount: {
      type: Number,
      required: true,
    },
    potAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["starting", "active", "completed", "cancelled", "error"],
      default: "starting",
    },
    result: {
      type: matchResultSchema,
      default: null,
    },
    currentBoard: {
      type: [[Number]],
      default: [],
    },
    currentTurn: {
      type: String,
      enum: ["a", "b"],
      default: "a",
    },
    moveCount: {
      type: Number,
      default: 0,
    },
    timeouts: {
      a: { type: Number, default: 0 },
      b: { type: Number, default: 0 },
    },
    txHashes: {
      escrow: { type: String, default: null },
      payout: { type: String, default: null },
    },
    startedAt: {
      type: Date,
      default: null,
    },
    endedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "matches",
  }
);

matchSchema.index({ status: 1 });
matchSchema.index({ "agents.a.userId": 1 });
matchSchema.index({ "agents.b.userId": 1 });
matchSchema.index({ createdAt: -1 });
matchSchema.index({ "agents.a.agentId": 1, status: 1 });
matchSchema.index({ "agents.b.agentId": 1, status: 1 });

export const MatchModel: Model<IMatch> = mongoose.model<IMatch>("Match", matchSchema);
