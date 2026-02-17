import { EventEmitter } from "node:events";
import type { EventBusEvents, EventName } from "@alpharena/shared";

/**
 * Typed EventBus that emits and listens for strongly-typed AlphArena events.
 *
 * Wraps the native Node.js EventEmitter, overriding the core methods to
 * enforce compile-time safety on the event name and its payload shape.
 */
export class EventBus extends EventEmitter {
  /**
   * Emit a typed event with its associated payload.
   */
  override emit<K extends EventName>(event: K, data: EventBusEvents[K]): boolean {
    return super.emit(event, data);
  }

  /**
   * Register a listener for a typed event.
   */
  override on<K extends EventName>(
    event: K,
    listener: (data: EventBusEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  /**
   * Register a one-time listener for a typed event.
   */
  override once<K extends EventName>(
    event: K,
    listener: (data: EventBusEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  /**
   * Remove a listener for a typed event.
   */
  override off<K extends EventName>(
    event: K,
    listener: (data: EventBusEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  /**
   * Remove all listeners for a given typed event, or all events if none specified.
   */
  override removeAllListeners(event?: EventName): this {
    return super.removeAllListeners(event);
  }
}

/** Singleton EventBus instance shared across the orchestrator. */
export const eventBus = new EventBus();
