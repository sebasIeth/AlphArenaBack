import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { EventBusEvents, EventName } from '../common/types';

@Injectable()
export class EventBusService extends EventEmitter {
  override emit<K extends EventName>(event: K, data: EventBusEvents[K]): boolean {
    return super.emit(event, data);
  }

  override on<K extends EventName>(
    event: K,
    listener: (data: EventBusEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  override once<K extends EventName>(
    event: K,
    listener: (data: EventBusEvents[K]) => void,
  ): this {
    return super.once(event, listener);
  }

  override off<K extends EventName>(
    event: K,
    listener: (data: EventBusEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  override removeAllListeners(event?: EventName): this {
    return super.removeAllListeners(event);
  }
}
