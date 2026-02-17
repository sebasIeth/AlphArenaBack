import pino from "pino";
import { loadConfig } from "@alpharena/shared";
import { connectDatabase, disconnectDatabase } from "@alpharena/db";
import { runMatchCleanup } from "./jobs/match-cleanup.js";
import { runRatingUpdate } from "./jobs/rating-update.js";
import { runStatsAggregation } from "./jobs/stats-aggregation.js";

const logger = pino({ name: "worker" });

const MATCH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const RATING_UPDATE_INTERVAL_MS = 10 * 60 * 1000;   // 10 minutes
const STATS_AGGREGATION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

const intervals: NodeJS.Timeout[] = [];

/**
 * Wrap a job function so that any thrown errors are logged instead of
 * crashing the worker process.
 */
function safeRun(jobName: string, fn: () => Promise<void>): () => void {
  return () => {
    fn().catch((err: unknown) => {
      logger.error({ err, job: jobName }, `Job "${jobName}" failed`);
    });
  };
}

/**
 * Schedule a recurring job and run it immediately on startup.
 */
function scheduleJob(
  jobName: string,
  fn: () => Promise<void>,
  intervalMs: number
): void {
  const wrapped = safeRun(jobName, fn);

  // Run immediately on startup
  wrapped();

  // Then repeat on the configured interval
  const handle = setInterval(wrapped, intervalMs);
  intervals.push(handle);

  logger.info(
    { job: jobName, intervalMs },
    `Scheduled "${jobName}" to run every ${intervalMs / 1000}s`
  );
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down worker...");

  // Clear all scheduled intervals
  for (const handle of intervals) {
    clearInterval(handle);
  }
  intervals.length = 0;

  // Disconnect from the database
  await disconnectDatabase();

  logger.info("Worker stopped");
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info("Starting AlphArena worker process");

  // Load validated configuration from environment
  const config = loadConfig();

  // Connect to MongoDB
  await connectDatabase(config.MONGODB_URI);
  logger.info("Connected to MongoDB");

  // Schedule recurring jobs
  scheduleJob("match-cleanup", runMatchCleanup, MATCH_CLEANUP_INTERVAL_MS);
  scheduleJob("rating-update", runRatingUpdate, RATING_UPDATE_INTERVAL_MS);
  scheduleJob("stats-aggregation", runStatsAggregation, STATS_AGGREGATION_INTERVAL_MS);

  logger.info("All jobs scheduled. Worker is running.");

  // Handle graceful shutdown
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Worker failed to start");
  process.exit(1);
});
