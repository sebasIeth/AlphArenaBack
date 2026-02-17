import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { MatchModel, MoveModel } from "@alpharena/db";

/**
 * Zod schema for match listing query parameters.
 */
const listMatchesQuerySchema = z.object({
  status: z
    .enum(["starting", "active", "completed", "cancelled", "error"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Match route plugin.
 *
 * GET /matches          - List matches with pagination and optional status filter
 * GET /matches/active   - List currently active matches
 * GET /matches/:id      - Get match by ID with full details
 * GET /matches/:id/moves - Get move history for a match
 */
export async function matchRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /matches
   * List matches with pagination. Optionally filter by status.
   */
  fastify.get(
    "/",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parseResult = listMatchesQuerySchema.safeParse(request.query);
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

      const { status, limit, offset } = parseResult.data;

      const filter: Record<string, unknown> = {};
      if (status) {
        filter.status = status;
      }

      const [matches, total] = await Promise.all([
        MatchModel.find(filter)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .lean(),
        MatchModel.countDocuments(filter),
      ]);

      return reply.send({
        matches,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      });
    },
  );

  /**
   * GET /matches/active
   * List all currently active matches (status "active" or "starting").
   */
  fastify.get(
    "/active",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const matches = await MatchModel.find({
        status: { $in: ["active", "starting"] },
      })
        .sort({ createdAt: -1 })
        .lean();

      return reply.send({ matches, count: matches.length });
    },
  );

  /**
   * GET /matches/:id
   * Get full details of a specific match by ID.
   */
  fastify.get(
    "/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const match = await MatchModel.findById(id).lean();
      if (!match) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Match not found",
        });
      }

      return reply.send({ match });
    },
  );

  /**
   * GET /matches/:id/moves
   * Get the full move history for a match, ordered by move number.
   */
  fastify.get(
    "/:id/moves",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      // Verify the match exists
      const match = await MatchModel.findById(id).lean();
      if (!match) {
        return reply.code(404).send({
          error: "Not Found",
          message: "Match not found",
        });
      }

      const moves = await MoveModel.find({ matchId: id })
        .sort({ moveNumber: 1 })
        .lean();

      return reply.send({
        matchId: id,
        moves,
        totalMoves: moves.length,
      });
    },
  );
}
