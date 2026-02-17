import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";

/**
 * Register the @fastify/rate-limit plugin on the Fastify instance.
 *
 * - Authenticated users: 100 requests per minute
 * - Unauthenticated users: 20 requests per minute
 *
 * The key generator uses the authenticated user's ID when available,
 * falling back to the client IP address for unauthenticated requests.
 */
export async function registerRateLimit(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rateLimit, {
    global: true,
    max: (request: FastifyRequest, _key: string) => {
      // After the auth plugin runs, request.user will be set for
      // authenticated requests. Provide a higher limit for them.
      if (request.user && request.user.userId) {
        return 100;
      }
      return 20;
    },
    timeWindow: "1 minute",
    keyGenerator: (request: FastifyRequest) => {
      // Use the user ID as the rate-limit key for authenticated users
      // so each user gets their own bucket. Fall back to IP for guests.
      if (request.user && request.user.userId) {
        return request.user.userId;
      }
      return request.ip;
    },
    errorResponseBuilder: (_request: FastifyRequest, context) => {
      return {
        error: "Too Many Requests",
        message: `Rate limit exceeded. You can make ${context.max} requests per ${context.after}. Please try again later.`,
        statusCode: 429,
      };
    },
  });
}
