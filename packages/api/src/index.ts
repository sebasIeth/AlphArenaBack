import { loadConfig } from "@alpharena/shared";
import { buildServer } from "./server.js";

/**
 * Application entry point.
 *
 * Loads environment configuration, builds the Fastify server with all
 * plugins and routes, and starts listening for requests.
 */
async function main(): Promise<void> {
  // Load and validate environment variables
  const config = loadConfig();

  // Build the fully configured server
  const server = await buildServer();

  try {
    // Start listening
    const address = await server.listen({
      host: config.HOST,
      port: config.PORT,
    });

    server.log.info(`AlphArena API server listening at ${address}`);
  } catch (err) {
    server.log.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}

// Handle uncaught errors
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

// Start the application
main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
