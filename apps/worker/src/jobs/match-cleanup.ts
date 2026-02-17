import pino from "pino";
import { MatchModel, AgentModel } from "@alpharena/db";

const logger = pino({ name: "job:match-cleanup" });

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Find matches stuck in "starting" or "active" status that haven't been
 * updated in 30+ minutes, mark them as "error" with reason "disconnect",
 * and reset the associated agents back to "idle".
 */
export async function runMatchCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const staleMatches = await MatchModel.find({
    status: { $in: ["starting", "active"] },
    updatedAt: { $lt: cutoff },
  });

  if (staleMatches.length === 0) {
    logger.info("No stale matches found");
    return;
  }

  const staleMatchIds = staleMatches.map((m) => m._id);

  // Collect all agent IDs from stale matches to reset their status
  const agentIds = staleMatches.flatMap((m) => [
    m.agents.a.agentId,
    m.agents.b.agentId,
  ]);

  // Mark all stale matches as "error" with disconnect reason
  const matchUpdateResult = await MatchModel.updateMany(
    { _id: { $in: staleMatchIds } },
    {
      $set: {
        status: "error",
        result: {
          winnerId: null,
          reason: "disconnect",
          finalScore: { a: 0, b: 0 },
          totalMoves: 0,
          eloChange: { a: 0, b: 0 },
        },
        endedAt: new Date(),
      },
    }
  );

  // Reset associated agents back to "idle" (only if they are currently
  // in a match-related status, not if they have been disabled)
  const agentUpdateResult = await AgentModel.updateMany(
    {
      _id: { $in: agentIds },
      status: { $in: ["queued", "in_match"] },
    },
    { $set: { status: "idle" } }
  );

  logger.info(
    {
      matchesCleaned: matchUpdateResult.modifiedCount,
      agentsReset: agentUpdateResult.modifiedCount,
    },
    `Cleaned up ${matchUpdateResult.modifiedCount} stale match(es), reset ${agentUpdateResult.modifiedCount} agent(s) to idle`
  );
}
