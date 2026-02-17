import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "@alpharena/shared";
import { AgentModel } from "@alpharena/db";
import { SettlementService } from "@alpharena/settlement";
import {
  MatchmakingQueue,
  MatchmakingService,
} from "@alpharena/matchmaking";
import { OrchestratorService, eventBus } from "@alpharena/orchestrator";
import type { MatchAgentInput } from "@alpharena/orchestrator";
import { MatchRooms, Broadcaster } from "@alpharena/realtime";

import { authPlugin } from "./middleware/auth.js";
import { registerRateLimit } from "./middleware/rate-limit.js";
import { mongodbPlugin } from "./plugins/mongodb.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { agentRoutes } from "./routes/agents.js";
import { matchRoutes } from "./routes/matches.js";
import { matchmakingRoutes } from "./routes/matchmaking.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";

/**
 * Build and configure the Fastify application with all plugins and routes.
 *
 * This function wires up every component of the AlphArena API:
 * - CORS, rate limiting, auth middleware
 * - MongoDB connection
 * - WebSocket support with match rooms
 * - REST routes under appropriate prefixes
 * - Background services (settlement, matchmaking, orchestrator, broadcaster)
 * - Graceful shutdown hooks
 *
 * @returns The configured (but not yet listening) Fastify instance.
 */
export async function buildServer() {
  const config = loadConfig();

  // ── Create Fastify instance ──────────────────────────────────────
  const fastify = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  // ── Core plugins ─────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: true, // Allow all origins in dev; restrict in production
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Auth plugin must be registered before rate limiting so that
  // the rate-limit key generator can access request.user
  await fastify.register(authPlugin);
  await registerRateLimit(fastify);

  // MongoDB connection
  await fastify.register(mongodbPlugin);

  // ── Initialize services ──────────────────────────────────────────

  // Settlement service (handles on-chain escrow / payout)
  const settlementService = new SettlementService({
    rpcUrl: config.RPC_URL,
    privateKey: config.PRIVATE_KEY,
    chainId: config.CHAIN_ID,
    contractAddress: config.CONTRACT_ADDRESS,
    usdcAddress: config.USDC_ADDRESS,
  });
  settlementService.start();

  // Orchestrator service (manages active match lifecycle)
  const orchestratorService = new OrchestratorService(settlementService);
  orchestratorService.start();

  // Matchmaking queue + service
  const queue = new MatchmakingQueue();
  const matchmakingService = new MatchmakingService({
    queue,
    onPaired: async (
      agentAId: string,
      agentBId: string,
      stakeAmount: number,
      gameType: string,
    ): Promise<string> => {
      // Look up agents to construct MatchAgentInput objects
      const [agentA, agentB] = await Promise.all([
        AgentModel.findById(agentAId),
        AgentModel.findById(agentBId),
      ]);

      if (!agentA || !agentB) {
        throw new Error("One or both agents not found during pairing");
      }

      const inputA: MatchAgentInput = {
        agentId: agentAId,
        userId: agentA.userId.toString(),
        name: agentA.name,
        endpointUrl: agentA.endpointUrl,
        eloRating: agentA.eloRating,
      };

      const inputB: MatchAgentInput = {
        agentId: agentBId,
        userId: agentB.userId.toString(),
        name: agentB.name,
        endpointUrl: agentB.endpointUrl,
        eloRating: agentB.eloRating,
      };

      const matchId = await orchestratorService.startMatch(
        inputA,
        inputB,
        stakeAmount,
        gameType,
      );
      fastify.log.info(
        { matchId, agentAId, agentBId, gameType, stakeAmount },
        "Match started from matchmaking pairing",
      );
      return matchId;
    },
  });
  await matchmakingService.start();

  // Real-time WebSocket rooms + broadcaster
  const rooms = new MatchRooms();
  const broadcaster = new Broadcaster({
    rooms,
    eventBus,
  });
  broadcaster.start();

  // WebSocket plugin (registers the /ws/matches/:matchId route)
  await fastify.register(websocketPlugin, { rooms });

  // ── REST routes ──────────────────────────────────────────────────
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(agentRoutes, { prefix: "/agents" });
  await fastify.register(matchRoutes, { prefix: "/matches" });
  await fastify.register(matchmakingRoutes, {
    prefix: "/matchmaking",
    matchmakingService,
  } as Parameters<typeof matchmakingRoutes>[1] & { prefix: string });
  await fastify.register(leaderboardRoutes, { prefix: "/leaderboard" });

  // ── Graceful shutdown ────────────────────────────────────────────
  fastify.addHook("onClose", async (_instance) => {
    fastify.log.info("Shutting down services...");

    broadcaster.stop();
    matchmakingService.stop();
    await orchestratorService.stop();
    settlementService.stop();

    fastify.log.info("All services stopped");
  });

  return fastify;
}
