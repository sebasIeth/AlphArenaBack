import { EventEmitter } from "node:events";
import pino from "pino";
import type {
  MatchStartedEvent,
  MatchMoveEvent,
  MatchTimeoutEvent,
  MatchEndedEvent,
} from "@alpharena/shared";
import { MatchRooms } from "./rooms.js";
import {
  serializeMatchStart,
  serializeMoveEvent,
  serializeMatchEnd,
  serializeTimeoutEvent,
} from "./serializer.js";

const logger = pino({ name: "realtime:broadcaster" });

export interface BroadcasterOptions {
  rooms: MatchRooms;
  eventBus: EventEmitter;
}

/**
 * Bridges the application EventBus to WebSocket clients.
 * Subscribes to match lifecycle events and broadcasts serialized
 * data to the appropriate match rooms.
 */
export class Broadcaster {
  private rooms: MatchRooms;
  private eventBus: EventEmitter;
  private handlers: Map<string, (...args: unknown[]) => void> = new Map();

  constructor(options: BroadcasterOptions) {
    this.rooms = options.rooms;
    this.eventBus = options.eventBus;
  }

  /**
   * Subscribe to EventBus events and begin broadcasting to rooms.
   */
  start(): void {
    logger.info("Broadcaster starting, subscribing to match events");

    const onMatchStarted = (data: MatchStartedEvent): void => {
      logger.debug({ matchId: data.matchId }, "Broadcasting match:start");
      this.rooms.broadcast(data.matchId, {
        type: "match:start",
        data: serializeMatchStart(data),
      });
    };

    const onMatchMove = (data: MatchMoveEvent): void => {
      logger.debug(
        { matchId: data.matchId, moveNumber: data.moveNumber },
        "Broadcasting match:move",
      );
      this.rooms.broadcast(data.matchId, {
        type: "match:move",
        data: serializeMoveEvent(data),
      });
    };

    const onMatchTimeout = (data: MatchTimeoutEvent): void => {
      logger.debug(
        { matchId: data.matchId, side: data.side },
        "Broadcasting match:timeout",
      );
      this.rooms.broadcast(data.matchId, {
        type: "match:timeout",
        data: serializeTimeoutEvent(data),
      });
    };

    const onMatchEnded = (data: MatchEndedEvent): void => {
      logger.info({ matchId: data.matchId }, "Broadcasting match:end and cleaning up room");
      this.rooms.broadcast(data.matchId, {
        type: "match:end",
        data: serializeMatchEnd(data),
      });
      this.rooms.cleanup(data.matchId);
    };

    this.eventBus.on("match:started", onMatchStarted);
    this.eventBus.on("match:move", onMatchMove);
    this.eventBus.on("match:timeout", onMatchTimeout);
    this.eventBus.on("match:ended", onMatchEnded);

    this.handlers.set("match:started", onMatchStarted as (...args: unknown[]) => void);
    this.handlers.set("match:move", onMatchMove as (...args: unknown[]) => void);
    this.handlers.set("match:timeout", onMatchTimeout as (...args: unknown[]) => void);
    this.handlers.set("match:ended", onMatchEnded as (...args: unknown[]) => void);

    logger.info("Broadcaster started, listening for match events");
  }

  /**
   * Remove all event listeners and stop broadcasting.
   */
  stop(): void {
    logger.info("Broadcaster stopping, removing event listeners");

    for (const [event, handler] of this.handlers) {
      this.eventBus.removeListener(event, handler);
    }

    this.handlers.clear();
    logger.info("Broadcaster stopped");
  }
}
