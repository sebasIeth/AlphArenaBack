import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AgentModel } from "@alpharena/db";
import { GAME_TYPES, DEFAULT_ELO } from "@alpharena/shared";
import { authenticate } from "../middleware/auth.js";

/**
 * Zod schema for creating an agent.
 */
const createAgentSchema = z.object({
  name: z
    .string()
    .min(1, "Agent name is required")
    .max(50, "Agent name must be at most 50 characters"),
  endpointUrl: z
    .string()
    .url("Endpoint URL must be a valid URL"),
  gameTypes: z
    .array(z.enum(GAME_TYPES))
    .min(1, "At least one game type is required"),
});

/**
 * Zod schema for updating an agent.
 */
const updateAgentSchema = z.object({
  name: z
    .string()
    .min(1, "Agent name cannot be empty")
    .max(50, "Agent name must be at most 50 characters")
    .optional(),
  endpointUrl: z
    .string()
    .url("Endpoint URL must be a valid URL")
    .optional(),
  gameTypes: z
    .array(z.enum(GAME_TYPES))
    .min(1, "At least one game type is required")
    .optional(),
});

/**
 * Agent CRUD route plugin. All routes require authentication.
 *
 * POST   /agents      - Create a new agent
 * GET    /agents      - List all agents owned by the current user
 * GET    /agents/:id  - Get a specific agent by ID (must own it)
 * PUT    /agents/:id  - Update an agent
 * DELETE /agents/:id  - Disable an agent (soft delete)
 */
export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes in this plugin require authentication
  fastify.addHook("preHandler", authenticate);

  /**
   * POST /agents
   * Create a new agent for the authenticated user.
   */
  fastify.post(
    "/",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = createAgentSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid agent data",
          details: errors,
        });
      }

      const { name, endpointUrl, gameTypes } = parseResult.data;

      // Check for duplicate agent name for this user
      const existing = await AgentModel.findOne({
        userId: request.user.userId,
        name,
        status: { $ne: "disabled" },
      });
      if (existing) {
        return reply.code(409).send({
          error: "Conflict",
          message: "You already have an agent with this name",
        });
      }

      const agent = await AgentModel.create({
        userId: request.user.userId,
        name,
        endpointUrl,
        gameTypes,
        eloRating: DEFAULT_ELO,
        status: "idle",
        stats: {
          wins: 0,
          losses: 0,
          draws: 0,
          totalMatches: 0,
          winRate: 0,
          totalEarnings: 0,
        },
      });

      fastify.log.info(
        { agentId: agent._id, name, userId: request.user.userId },
        "Agent created",
      );

      return reply.code(201).send({ agent });
    },
  );

  /**
   * GET /agents
   * List all agents owned by the authenticated user.
   */
  fastify.get(
    "/",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const agents = await AgentModel.find({
        userId: request.user.userId,
        status: { $ne: "disabled" },
      }).sort({ createdAt: -1 });

      return reply.send({ agents });
    },
  );

  /**
   * GET /agents/:id
   * Get a specific agent by ID. The agent must belong to the authenticated user.
   */
  fastify.get(
    "/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const agent = await AgentModel.findById(id);
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

      return reply.send({ agent });
    },
  );

  /**
   * PUT /agents/:id
   * Update an agent's properties. The agent must belong to the authenticated user.
   */
  fastify.put(
    "/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parseResult = updateAgentSchema.safeParse(request.body);
      if (!parseResult.success) {
        const errors = parseResult.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }));
        return reply.code(400).send({
          error: "Validation Error",
          message: "Invalid update data",
          details: errors,
        });
      }

      const agent = await AgentModel.findById(id);
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

      if (agent.status === "disabled") {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Cannot update a disabled agent",
        });
      }

      const updates = parseResult.data;

      // Check for name conflicts if name is being changed
      if (updates.name && updates.name !== agent.name) {
        const nameConflict = await AgentModel.findOne({
          userId: request.user.userId,
          name: updates.name,
          status: { $ne: "disabled" },
          _id: { $ne: id },
        });
        if (nameConflict) {
          return reply.code(409).send({
            error: "Conflict",
            message: "You already have an agent with this name",
          });
        }
      }

      if (updates.name !== undefined) agent.name = updates.name;
      if (updates.endpointUrl !== undefined) agent.endpointUrl = updates.endpointUrl;
      if (updates.gameTypes !== undefined) agent.gameTypes = updates.gameTypes;

      await agent.save();

      fastify.log.info({ agentId: id, updates }, "Agent updated");

      return reply.send({ agent });
    },
  );

  /**
   * DELETE /agents/:id
   * Soft-delete an agent by setting its status to "disabled".
   * The agent must belong to the authenticated user and must not be in a match.
   */
  fastify.delete(
    "/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const agent = await AgentModel.findById(id);
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

      if (agent.status === "in_match") {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Cannot disable an agent that is currently in a match",
        });
      }

      if (agent.status === "queued") {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Cannot disable an agent that is currently in the matchmaking queue. Remove it from the queue first.",
        });
      }

      agent.status = "disabled";
      await agent.save();

      fastify.log.info({ agentId: id }, "Agent disabled");

      return reply.send({ message: "Agent disabled successfully", agent });
    },
  );
}
