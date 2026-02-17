import type { FastifyInstance } from "fastify";
import { connectDatabase, disconnectDatabase } from "@alpharena/db";
import { loadConfig } from "@alpharena/shared";

/**
 * Fastify plugin that connects to MongoDB on startup and disconnects
 * when the server shuts down.
 *
 * Reads the MONGODB_URI from the application's environment config.
 */
export async function mongodbPlugin(fastify: FastifyInstance): Promise<void> {
  const config = loadConfig();

  fastify.log.info("Connecting to MongoDB...");
  await connectDatabase(config.MONGODB_URI);
  fastify.log.info("MongoDB connected successfully");

  // Ensure we disconnect gracefully when the server closes
  fastify.addHook("onClose", async (_instance) => {
    fastify.log.info("Disconnecting from MongoDB...");
    await disconnectDatabase();
    fastify.log.info("MongoDB disconnected");
  });
}
