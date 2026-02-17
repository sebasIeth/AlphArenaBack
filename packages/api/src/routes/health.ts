import type { FastifyInstance } from "fastify";

/**
 * Health check route plugin.
 *
 * GET /health -> { status: "ok", timestamp, uptime }
 */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/health", async (_request, _reply) => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });
}
