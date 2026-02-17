import pino from "pino";
import { AgentModel } from "@alpharena/db";

const logger = pino({ name: "job:rating-update" });

/**
 * Recalculate winRate for all agents based on their current stats.
 * Only updates agents whose computed winRate differs from the stored value.
 */
export async function runRatingUpdate(): Promise<void> {
  const agents = await AgentModel.find({}, {
    "stats.wins": 1,
    "stats.totalMatches": 1,
    "stats.winRate": 1,
  });

  if (agents.length === 0) {
    logger.info("No agents found for rating update");
    return;
  }

  const bulkOps = [];

  for (const agent of agents) {
    const { wins, totalMatches, winRate: storedWinRate } = agent.stats;
    const computedWinRate = totalMatches > 0 ? wins / totalMatches : 0;

    // Round to 4 decimal places to avoid floating-point drift causing
    // unnecessary updates on every run
    const roundedWinRate = Math.round(computedWinRate * 10000) / 10000;

    if (roundedWinRate !== storedWinRate) {
      bulkOps.push({
        updateOne: {
          filter: { _id: agent._id },
          update: { $set: { "stats.winRate": roundedWinRate } },
        },
      });
    }
  }

  if (bulkOps.length === 0) {
    logger.info("All agent win rates are up to date");
    return;
  }

  const result = await AgentModel.bulkWrite(bulkOps);

  logger.info(
    { agentsUpdated: result.modifiedCount },
    `Updated win rates for ${result.modifiedCount} agent(s)`
  );
}
