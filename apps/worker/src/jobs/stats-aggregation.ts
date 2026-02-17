import pino from "pino";
import { MatchModel, AgentModel } from "@alpharena/db";
import type { Types } from "mongoose";

const logger = pino({ name: "job:stats-aggregation" });

interface AggregatedAgentStats {
  _id: Types.ObjectId;
  totalMatches: number;
  wins: number;
  losses: number;
  draws: number;
  totalEarnings: number;
}

/**
 * Aggregate match data per agent and update each agent's stats document
 * in bulk. Uses the MongoDB aggregation pipeline on the matches collection
 * to compute totals for completed matches.
 */
export async function runStatsAggregation(): Promise<void> {
  // Build an aggregation pipeline that "unwinds" each match into two
  // rows -- one per participating agent (side a and side b).
  const pipeline = [
    // Only consider completed matches that have a result
    { $match: { status: "completed", result: { $ne: null } } },

    // Project each side into a uniform shape so we can $unionWith-style
    // combine them via $facet then $concatArrays, but a cleaner approach
    // is to use $facet with two branches.
    {
      $facet: {
        sideA: [
          {
            $project: {
              agentId: "$agents.a.agentId",
              isWinner: {
                $cond: [
                  { $eq: ["$result.winnerId", "$agents.a.agentId"] },
                  true,
                  false,
                ],
              },
              isDraw: { $eq: ["$result.reason", "draw"] },
              earnings: {
                $cond: [
                  { $eq: ["$result.winnerId", "$agents.a.agentId"] },
                  "$potAmount",
                  0,
                ],
              },
            },
          },
        ],
        sideB: [
          {
            $project: {
              agentId: "$agents.b.agentId",
              isWinner: {
                $cond: [
                  { $eq: ["$result.winnerId", "$agents.b.agentId"] },
                  true,
                  false,
                ],
              },
              isDraw: { $eq: ["$result.reason", "draw"] },
              earnings: {
                $cond: [
                  { $eq: ["$result.winnerId", "$agents.b.agentId"] },
                  "$potAmount",
                  0,
                ],
              },
            },
          },
        ],
      },
    },

    // Merge both sides into a single array
    {
      $project: {
        allSides: { $concatArrays: ["$sideA", "$sideB"] },
      },
    },
    { $unwind: "$allSides" },
    { $replaceRoot: { newRoot: "$allSides" } },

    // Group by agentId and compute aggregate stats
    {
      $group: {
        _id: "$agentId",
        totalMatches: { $sum: 1 },
        wins: {
          $sum: {
            $cond: [{ $and: [{ $eq: ["$isWinner", true] }, { $eq: ["$isDraw", false] }] }, 1, 0],
          },
        },
        losses: {
          $sum: {
            $cond: [{ $and: [{ $eq: ["$isWinner", false] }, { $eq: ["$isDraw", false] }] }, 1, 0],
          },
        },
        draws: {
          $sum: { $cond: [{ $eq: ["$isDraw", true] }, 1, 0] },
        },
        totalEarnings: { $sum: "$earnings" },
      },
    },
  ];

  const results = (await MatchModel.aggregate(
    pipeline
  )) as AggregatedAgentStats[];

  if (results.length === 0) {
    logger.info("No completed matches found for stats aggregation");
    return;
  }

  // Build bulk update operations
  const bulkOps = results.map((stat) => {
    const winRate =
      stat.totalMatches > 0
        ? Math.round((stat.wins / stat.totalMatches) * 10000) / 10000
        : 0;

    return {
      updateOne: {
        filter: { _id: stat._id },
        update: {
          $set: {
            "stats.wins": stat.wins,
            "stats.losses": stat.losses,
            "stats.draws": stat.draws,
            "stats.totalMatches": stat.totalMatches,
            "stats.winRate": winRate,
            "stats.totalEarnings": stat.totalEarnings,
          },
        },
      },
    };
  });

  const bulkResult = await AgentModel.bulkWrite(bulkOps);

  logger.info(
    {
      agentsProcessed: results.length,
      agentsUpdated: bulkResult.modifiedCount,
    },
    `Aggregated stats for ${results.length} agent(s), updated ${bulkResult.modifiedCount}`
  );
}
