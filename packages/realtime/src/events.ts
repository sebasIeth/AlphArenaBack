import type { WebSocket } from "ws";
import pino from "pino";
import type { WsClientMessage, WsServerMessage } from "@alpharena/shared";
import { MatchRooms } from "./rooms.js";

const logger = pino({ name: "realtime:events" });

/**
 * Send a typed WsServerMessage to a single WebSocket client.
 */
function sendMessage(ws: WebSocket, message: WsServerMessage): void {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  } catch (err) {
    logger.warn({ err }, "Failed to send message to client");
  }
}

/**
 * Validate that an incoming message conforms to the expected WsClientMessage format.
 * Returns the parsed message if valid, or null if invalid.
 */
function parseClientMessage(raw: string): WsClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const msg = parsed as Record<string, unknown>;

  if (typeof msg.type !== "string") {
    return null;
  }

  const validTypes = ["subscribe", "unsubscribe", "ping"];
  if (!validTypes.includes(msg.type)) {
    return null;
  }

  // subscribe and unsubscribe require a matchId
  if ((msg.type === "subscribe" || msg.type === "unsubscribe") && typeof msg.matchId !== "string") {
    return null;
  }

  return msg as unknown as WsClientMessage;
}

/**
 * Handle an incoming WebSocket message from a client.
 * Parses the message, validates it, and performs the appropriate action.
 */
export function handleWsMessage(ws: WebSocket, message: string, rooms: MatchRooms): void {
  const parsed = parseClientMessage(message);

  if (!parsed) {
    logger.debug({ raw: message.slice(0, 200) }, "Received invalid message from client");
    sendMessage(ws, {
      type: "error",
      data: { message: "Invalid message format. Expected JSON with { type, matchId? }." },
    });
    return;
  }

  switch (parsed.type) {
    case "subscribe": {
      const matchId = parsed.matchId!;
      rooms.join(matchId, ws);
      logger.info({ matchId }, "Client subscribed to match");

      // Acknowledge the subscription
      sendMessage(ws, {
        type: "match:state",
        data: {
          matchId,
          subscribed: true,
          viewers: rooms.getRoomSize(matchId),
        },
      });
      break;
    }

    case "unsubscribe": {
      const matchId = parsed.matchId!;
      rooms.leave(matchId, ws);
      logger.info({ matchId }, "Client unsubscribed from match");
      break;
    }

    case "ping": {
      sendMessage(ws, {
        type: "pong",
        data: { timestamp: Date.now() },
      });
      break;
    }
  }
}

/**
 * Handle a WebSocket connection close event.
 * Removes the client from all rooms it was subscribed to.
 */
export function handleWsClose(ws: WebSocket, rooms: MatchRooms): void {
  logger.debug("Client disconnected, cleaning up rooms");
  rooms.leaveAll(ws);
}
