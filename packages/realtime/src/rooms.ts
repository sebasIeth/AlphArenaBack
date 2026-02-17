import type { WebSocket } from "ws";
import pino from "pino";

const logger = pino({ name: "realtime:rooms" });

/**
 * Manages WebSocket client rooms keyed by matchId.
 * Each room is a Set of WebSocket connections watching that match.
 */
export class MatchRooms {
  private rooms: Map<string, Set<WebSocket>> = new Map();

  /**
   * Add a WebSocket client to a match room.
   * Creates the room if it doesn't exist yet.
   */
  join(matchId: string, ws: WebSocket): void {
    let room = this.rooms.get(matchId);
    if (!room) {
      room = new Set();
      this.rooms.set(matchId, room);
      logger.info({ matchId }, "Created new room");
    }

    room.add(ws);
    logger.debug({ matchId, roomSize: room.size }, "Client joined room");
  }

  /**
   * Remove a client from a specific match room.
   * Cleans up the room if it becomes empty.
   */
  leave(matchId: string, ws: WebSocket): void {
    const room = this.rooms.get(matchId);
    if (!room) {
      return;
    }

    room.delete(ws);
    logger.debug({ matchId, roomSize: room.size }, "Client left room");

    if (room.size === 0) {
      this.rooms.delete(matchId);
      logger.info({ matchId }, "Room removed (empty)");
    }
  }

  /**
   * Remove a client from all rooms it belongs to.
   * Called when a WebSocket connection closes.
   */
  leaveAll(ws: WebSocket): void {
    for (const [matchId, room] of this.rooms) {
      if (room.has(ws)) {
        room.delete(ws);
        logger.debug({ matchId, roomSize: room.size }, "Client removed from room on disconnect");

        if (room.size === 0) {
          this.rooms.delete(matchId);
          logger.info({ matchId }, "Room removed (empty after disconnect)");
        }
      }
    }
  }

  /**
   * Send a JSON message to all clients in a match room.
   * Silently skips clients whose connection is not open.
   */
  broadcast(matchId: string, message: Record<string, unknown>): void {
    const room = this.rooms.get(matchId);
    if (!room || room.size === 0) {
      return;
    }

    const payload = JSON.stringify(message);
    let sentCount = 0;

    for (const ws of room) {
      try {
        // WebSocket readyState 1 === OPEN
        if (ws.readyState === 1) {
          ws.send(payload);
          sentCount++;
        }
      } catch (err) {
        logger.warn({ matchId, err }, "Failed to send message to client");
      }
    }

    logger.debug({ matchId, sentCount, totalClients: room.size }, "Broadcast sent");
  }

  /**
   * Return the number of clients watching a match.
   */
  getRoomSize(matchId: string): number {
    const room = this.rooms.get(matchId);
    return room ? room.size : 0;
  }

  /**
   * Remove a room entirely when a match ends.
   * Notifies remaining clients are expected to have already received
   * the match:end message before cleanup is called.
   */
  cleanup(matchId: string): void {
    const room = this.rooms.get(matchId);
    if (room) {
      logger.info({ matchId, clientsRemaining: room.size }, "Cleaning up room");
      this.rooms.delete(matchId);
    }
  }
}
