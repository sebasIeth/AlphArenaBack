import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "jsonwebtoken";
import { loadConfig, type AuthPayload } from "@alpharena/shared";

/**
 * Extend the Fastify request interface to include the authenticated user.
 */
declare module "fastify" {
  interface FastifyRequest {
    user: AuthPayload;
  }
}

/**
 * Fastify plugin that decorates requests with a `user` property
 * and provides an `authenticate` preHandler hook for protected routes.
 */
export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate the request prototype with a default `user` value.
  // This avoids the "FST_ERR_DEC_MISSING" error when accessing
  // `request.user` before authentication runs.
  fastify.decorateRequest("user", null as unknown as AuthPayload);
}

/**
 * PreHandler hook that verifies the JWT from the Authorization header
 * and attaches the decoded payload to `request.user`.
 *
 * Usage:
 *   fastify.get("/protected", { preHandler: [authenticate] }, handler);
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. Expected: Bearer <token>",
    });
    return;
  }

  const token = authHeader.slice(7); // Strip "Bearer "

  try {
    const config = loadConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET) as AuthPayload;

    // Attach the verified user payload to the request
    request.user = {
      userId: decoded.userId,
      username: decoded.username,
    };
  } catch (err) {
    const message =
      err instanceof jwt.TokenExpiredError
        ? "Token has expired"
        : err instanceof jwt.JsonWebTokenError
          ? "Invalid token"
          : "Authentication failed";

    reply.code(401).send({
      error: "Unauthorized",
      message,
    });
  }
}
