import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { GAME_TYPES, MIN_STAKE, MAX_STAKE } from "@alpharena/shared";
import { AgentModel } from "@alpharena/db";
import { authenticate } from "../middleware/auth.js";
import type { MatchmakingService } from "@alpharena/matchmaking";

/**
 * Zod schema for joining the matchmaking queue.
 */
const joinQueueSchema = z.object({
  agentId: z.string().min(1, "Agent ID is required"),
  stakeAmount: z
    .number()
    .min(MIN_STAKE, `Stake must be at least ${MIN_STAKE}`)
    .max(MAX_STAKE, `Stake must be at most ${MAX_STAKE}`),
  gameType: z.enum(GAME_TYPES),
});

/**
 * Zod schema for cancelling a queue entry.
 */
const cancelQueueSchema = z.object({
  agentId: z.string().min(1, "Agent ID is required"),
});

/**
 * Matchmaking route plugin. All routes require authentication.
 *
 * POST /matchmaking/join              - Join the matchmaking queue
 * POST /matchmaking/cancel            - Leave the matchmaking queue
 * GET  /matchmaking/status/:agentId   - Get queue status for an agent
 * GET  /matchmaking/queue-size        - Get current queue size
 *
 * @param options.matchmakingService - The shared MatchmakingService instance.
 */
export async function matchmakingRoutes(
  fastify: FastifyInstance,
  options: { matchmakingService: MatchmakingService },
): Promise<void> {
  const { matchmakingService } = options;

  // All routes in this plugin require authentication
  fastify.addHook("preHandler", authenticate);

  /**
   * POST /matchmaking/join
   * Join the matchmaking queue with a specific agent.
   */
  fastify.post(
    "/join",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = joinQueueSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid matchmaking data",
          details: errors,
        });
      }

      const { agentId, stakeAmount, gameType } = parseResult.data;

      // Verify the agent exists and belongs to the user
      const agent = await AgentModel.findById(agentId);
      if (!agent) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Agent not found",
        });
      }

      if (agent.userId.toString() !== request.user.userId) {
        return reply.code(403).send({
          error: "Forbidden",
          message: "You do not own this agent",
        });
      }

      // Agent must be idle to join the queue
      if (agent.status !== "idle") {
        return reply.code(400).send({
          error: "Bad Request",
          message: `Agent cannot join queue because its status is "${agent.status}". It must be "idle".`,
        });
      }

      // Verify the agent supports the requested game type
      if (!agent.gameTypes.includes(gameType)) {
        return reply.code(400).send({
          error: "Bad Request",
          message: `Agent does not support game type "${gameType}". Supported types: ${agent.gameTypes.join(", ")}`,
        });
      }

      // Update agent status to queued
      agent.status = "queued";
      await agent.save();

      try {
        // Add to matchmaking queue
        await matchmakingService.joinQueue(
          agentId,
          request.user.userId,
          agent.eloRating,
          stakeAmount,
          gameType,
        );

        fastify.log.info(
          { agentId, userId: request.user.userId, gameType, stakeAmount },
          "Agent joined matchmaking queue",
        );

        return reply.code(201).send({
          message: "Successfully joined the matchmaking queue",
          agentId,
          gameType,
          stakeAmount,
        });
      } catch (err) {
        // Revert agent status on failure
        agent.status = "idle";
        await agent.save();

        const message = err instanceof Error ? err.message : "Failed to join queue";
        fastify.log.error({ err, agentId }, "Failed to join matchmaking queue");

        return reply.code(500).send({
          error: "Internal Server Error",
          message,
        });
      }
    },
  );

  /**
   * POST /matchmaking/cancel
   * Leave the matchmaking queue.
   */
  fastify.post(
    "/cancel",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = cancelQueueSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid request data",
          details: errors,
        });
      }

      const { agentId } = parseResult.data;

      // Verify the agent exists and belongs to the user
      const agent = await AgentModel.findById(agentId);
      if (!agent) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Agent not found",
        });
      }

      if (agent.userId.toString() !== request.user.userId) {
        return reply.code(403).send({
          error: "Forbidden",
          message: "You do not own this agent",
        });
      }

      // Only allow cancellation if the agent is queued
      if (agent.status !== "queued") {
        return reply.code(400).send({
          error: "Bad Request",
          message: `Agent is not in the queue (current status: "${agent.status}")`,
        });
      }

      try {
        // Remove from matchmaking queue
        await matchmakingService.leaveQueue(agentId);

        // Set agent status back to idle
        agent.status = "idle";
        await agent.save();

        fastify.log.info({ agentId, userId: request.user.userId }, "Agent left matchmaking queue");

        return reply.send({
          message: "Successfully left the matchmaking queue",
          agentId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to leave queue";
        fastify.log.error({ err, agentId }, "Failed to leave matchmaking queue");

        return reply.code(500).send({
          error: "Internal Server Error",
          message,
        });
      }
    },
  );

  /**
   * GET /matchmaking/status/:agentId
   * Get the queue status for a specific agent.
   */
  fastify.get(
    "/status/:agentId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      // Verify the agent exists and belongs to the user
      const agent = await AgentModel.findById(agentId);
      if (!agent) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Agent not found",
        });
      }

      if (agent.userId.toString() !== request.user.userId) {
        return reply.code(403).send({
          error: "Forbidden",
          message: "You do not own this agent",
        });
      }

      const queueEntry = await matchmakingService.getQueueStatus(agentId);

      if (!queueEntry) {
        return reply.send({
          inQueue: false,
          agentId,
          agentStatus: agent.status,
        });
      }

      return reply.send({
        inQueue: true,
        agentId,
        agentStatus: agent.status,
        queueEntry: {
          gameType: queueEntry.gameType,
          stakeAmount: queueEntry.stakeAmount,
          eloRating: queueEntry.eloRating,
          status: queueEntry.status,
          joinedAt: queueEntry.joinedAt,
        },
      });
    },
  );

  /**
   * GET /matchmaking/queue-size
   * Get the current queue size, optionally filtered by game type.
   */
  fastify.get(
    "/queue-size",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { gameType } = request.query as { gameType?: string };

      const size = await matchmakingService.getQueueSize(gameType);

      return reply.send({
        queueSize: size,
        gameType: gameType ?? "all",
      });
    },
  );
}
