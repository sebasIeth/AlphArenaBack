import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import jwt from "jsonwebtoken";
import { loadConfig, type AuthPayload } from "@alpharena/shared";
import { MatchRooms, handleWsMessage, handleWsClose } from "@alpharena/realtime";

/**
 * Fastify plugin that registers the @fastify/websocket plugin and sets up
 * the WebSocket route for real-time match spectating.
 *
 * Route: /ws/matches/:matchId
 *
 * Clients must authenticate by passing a `token` query parameter containing
 * a valid JWT. On successful authentication the client is automatically
 * joined to the room for the requested match.
 *
 * @param rooms - The shared MatchRooms instance used across the application.
 */
export async function websocketPlugin(
  fastify: FastifyInstance,
  options: { rooms: MatchRooms },
): Promise<void> {
  const { rooms } = options;

  // Register the base @fastify/websocket plugin
  await fastify.register(websocket);

  // WebSocket route for match spectating
  fastify.get(
    "/ws/matches/:matchId",
    { websocket: true },
    (socket, request) => {
      const { matchId } = request.params as { matchId: string };
      const { token } = request.query as { token?: string };

      // Authenticate via query parameter
      if (!token) {
        socket.send(
          JSON.stringify({
            type: "error",
            data: { message: "Authentication required. Pass ?token=<jwt> as a query parameter." },
          }),
        );
        socket.close(4001, "Authentication required");
        return;
      }

      let user: AuthPayload;
      try {
        const config = loadConfig();
        user = jwt.verify(token, config.JWT_SECRET) as AuthPayload;
      } catch {
        socket.send(
          JSON.stringify({
            type: "error",
            data: { message: "Invalid or expired authentication token." },
          }),
        );
        socket.close(4001, "Invalid token");
        return;
      }

      fastify.log.info(
        { matchId, userId: user.userId, username: user.username },
        "WebSocket client authenticated and connected",
      );

      // Automatically join the room for the requested match
      rooms.join(matchId, socket);

      // Send initial acknowledgement
      socket.send(
        JSON.stringify({
          type: "match:state",
          data: {
            matchId,
            subscribed: true,
            viewers: rooms.getRoomSize(matchId),
          },
        }),
      );

      // Handle incoming messages
      socket.on("message", (rawData: Buffer | ArrayBuffer | Buffer[]) => {
        const messageStr =
          rawData instanceof Buffer
            ? rawData.toString("utf8")
            : Buffer.from(rawData as ArrayBuffer).toString("utf8");

        handleWsMessage(socket, messageStr, rooms);
      });

      // Handle disconnect
      socket.on("close", () => {
        fastify.log.debug(
          { matchId, userId: user.userId },
          "WebSocket client disconnected",
        );
        handleWsClose(socket, rooms);
      });

      // Handle errors
      socket.on("error", (err) => {
        fastify.log.error(
          { matchId, userId: user.userId, err },
          "WebSocket error",
        );
        handleWsClose(socket, rooms);
      });
    },
  );
}
