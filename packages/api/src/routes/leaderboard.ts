import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Types } from "mongoose";
import { z } from "zod";
import { AgentModel, MatchModel, UserModel } from "@alpharena/db";

interface UserAggResult {
  _id: Types.ObjectId;
  totalEarnings: number;
  totalWins: number;
  totalLosses: number;
  totalDraws: number;
  totalMatches: number;
  agentCount: number;
  bestElo: number;
}

interface UserLean {
  _id: Types.ObjectId;
  username?: string;
  walletAddress?: string;
}

/**
 * Zod schema for leaderboard query parameters.
 */
const leaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  gameType: z.string().optional(),
});

/**
 * Leaderboard route plugin.
 *
 * GET /leaderboard/agents          - Top agents by ELO rating
 * GET /leaderboard/users           - Top users by total earnings across agents
 * GET /leaderboard/agents/:id/stats - Detailed stats for a specific agent
 */
export async function leaderboardRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /leaderboard/agents
   * Return agents sorted by ELO rating (descending).
   * Optionally filter by game type.
   */
  fastify.get(
    "/agents",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = leaderboardQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid query parameters",
          details: errors,
        });
      }

      const { limit, gameType } = parseResult.data;

      const filter: Record<string, unknown> = {
        status: { $ne: "disabled" },
        "stats.totalMatches": { $gt: 0 },
      };

      if (gameType) {
        filter.gameTypes = gameType;
      }

      const agents = await AgentModel.find(filter)
        .sort({ eloRating: -1 })
        .limit(limit)
        .select("name eloRating stats gameTypes userId createdAt")
        .lean();

      // Rank the results
      const ranked = agents.map((agent, index) => ({
        rank: index + 1,
        agentId: agent._id,
        name: agent.name,
        eloRating: agent.eloRating,
        stats: agent.stats,
        gameTypes: agent.gameTypes,
        userId: agent.userId,
      }));

      return reply.send({ leaderboard: ranked });
    },
  );

  /**
   * GET /leaderboard/users
   * Return users sorted by total earnings across all their agents.
   */
  fastify.get(
    "/users",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = leaderboardQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid query parameters",
          details: errors,
        });
      }

      const { limit } = parseResult.data;

      // Aggregate total earnings per user across all their agents
      const userStats = await AgentModel.aggregate([
        { $match: { status: { $ne: "disabled" } } },
        {
          $group: {
            _id: "$userId",
            totalEarnings: { $sum: "$stats.totalEarnings" },
            totalWins: { $sum: "$stats.wins" },
            totalLosses: { $sum: "$stats.losses" },
            totalDraws: { $sum: "$stats.draws" },
            totalMatches: { $sum: "$stats.totalMatches" },
            agentCount: { $sum: 1 },
            bestElo: { $max: "$eloRating" },
          },
        },
        { $sort: { totalEarnings: -1 } },
        { $limit: limit },
      ]);

      // Fetch user details for the aggregated results
      const userIds = userStats.map((entry: UserAggResult) => entry._id);
      const users = await UserModel.find({ _id: { $in: userIds } })
        .select("username walletAddress")
        .lean() as UserLean[];

      const userMap = new Map(
        users.map((u: UserLean) => [u._id.toString(), u]),
      );

      const ranked = userStats.map((entry: UserAggResult, index: number) => {
        const user = userMap.get(entry._id.toString());
        return {
          rank: index + 1,
          userId: entry._id,
          username: user?.username ?? "Unknown",
          walletAddress: user?.walletAddress ?? "",
          totalEarnings: entry.totalEarnings,
          totalWins: entry.totalWins,
          totalLosses: entry.totalLosses,
          totalDraws: entry.totalDraws,
          totalMatches: entry.totalMatches,
          agentCount: entry.agentCount,
          bestElo: entry.bestElo,
        };
      });

      return reply.send({ leaderboard: ranked });
    },
  );

  /**
   * GET /leaderboard/agents/:id/stats
   * Return detailed stats for a specific agent, including recent match history.
   */
  fastify.get(
    "/agents/:id/stats",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const agent = await AgentModel.findById(id)
        .select("name eloRating stats gameTypes userId status createdAt")
        .lean();

      if (!agent) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Agent not found",
        });
      }

      // Find the agent's recent matches (last 20)
      const recentMatches = await MatchModel.find({
        $or: [
          { "agents.a.agentId": id },
          { "agents.b.agentId": id },
        ],
        status: "completed",
      })
        .sort({ endedAt: -1 })
        .limit(20)
        .select("agents result stakeAmount potAmount gameType endedAt")
        .lean();

      // Calculate additional stats
      const matchHistory = recentMatches.map((match) => {
        const isAgentA = match.agents.a.agentId.toString() === id;
        const side = isAgentA ? "a" : "b";
        const opponentSide = isAgentA ? "b" : "a";

        let outcome: "win" | "loss" | "draw";
        if (!match.result || match.result.winnerId === null) {
          outcome = "draw";
        } else if (match.result.winnerId.toString() === id) {
          outcome = "win";
        } else {
          outcome = "loss";
        }

        return {
          matchId: match._id,
          gameType: match.gameType,
          opponent: {
            agentId: match.agents[opponentSide].agentId,
            name: match.agents[opponentSide].name,
          },
          outcome,
          eloChange: match.result?.eloChange[side] ?? 0,
          finalScore: match.result?.finalScore ?? { a: 0, b: 0 },
          stakeAmount: match.stakeAmount,
          endedAt: match.endedAt,
        };
      });

      // Fetch the owner's username
      const owner = await UserModel.findById(agent.userId)
        .select("username")
        .lean();

      return reply.send({
        agent: {
          id: agent._id,
          name: agent.name,
          eloRating: agent.eloRating,
          stats: agent.stats,
          gameTypes: agent.gameTypes,
          status: agent.status,
          owner: {
            userId: agent.userId,
            username: owner?.username ?? "Unknown",
          },
          createdAt: agent.createdAt,
        },
        recentMatches: matchHistory,
      });
    },
  );
}
