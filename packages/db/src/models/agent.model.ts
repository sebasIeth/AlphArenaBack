import mongoose, { Schema, Document, Model, Types } from "mongoose";
import type { AgentStatus } from "@alpharena/shared";

export interface IAgentStats {
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  winRate: number;
  totalEarnings: number;
}

export interface IAgent extends Document {
  userId: Types.ObjectId;
  name: string;
  endpointUrl: string;
  eloRating: number;
  stats: IAgentStats;
  status: AgentStatus;
  gameTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const agentStatsSchema = new Schema<IAgentStats>(
  {
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalMatches: { type: Number, default: 0 },
    winRate: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
  },
  { _id: false }
);

const agentSchema = new Schema<IAgent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    endpointUrl: {
      type: String,
      required: true,
    },
    eloRating: {
      type: Number,
      default: 1200,
      index: true,
    },
    stats: {
      type: agentStatsSchema,
      default: () => ({
        wins: 0,
        losses: 0,
        draws: 0,
        totalMatches: 0,
        winRate: 0,
        totalEarnings: 0,
      }),
    },
    status: {
      type: String,
      enum: ["idle", "queued", "in_match", "disabled"],
      default: "idle",
    },
    gameTypes: {
      type: [String],
      default: ["reversi"],
    },
  },
  {
    timestamps: true,
    collection: "agents",
  }
);

agentSchema.index({ userId: 1 });
agentSchema.index({ eloRating: 1, status: 1 });
agentSchema.index({ "stats.winRate": -1 });

export const AgentModel: Model<IAgent> = mongoose.model<IAgent>("Agent", agentSchema);
