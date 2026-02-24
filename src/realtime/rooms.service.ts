import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);
  private readonly rooms = new Map<string, Set<Socket>>();
  private readonly allClients = new Set<Socket>();

  registerClient(client: Socket): void {
    this.allClients.add(client);
  }

  unregisterClient(client: Socket): void {
    this.allClients.delete(client);
  }

  broadcastAll(message: Record<string, unknown>): void {
    for (const client of this.allClients) {
      try {
        if (client.connected) {
          client.emit('message', message);
        }
      } catch {
        this.logger.warn(`Failed to broadcast to client ${client.id}`);
      }
    }
  }

  join(matchId: string, client: Socket): void {
    let room = this.rooms.get(matchId);
    if (!room) {
      room = new Set();
      this.rooms.set(matchId, room);
      this.logger.log(`Created new room for match ${matchId}`);
    }
    room.add(client);
    this.logger.debug(`Client ${client.id} joined room ${matchId} (size: ${room.size})`);
  }

  leave(matchId: string, client: Socket): void {
    const room = this.rooms.get(matchId);
    if (!room) return;

    room.delete(client);
    this.logger.debug(`Client ${client.id} left room ${matchId} (size: ${room.size})`);

    if (room.size === 0) {
      this.rooms.delete(matchId);
      this.logger.log(`Room ${matchId} removed (empty)`);
    }
  }

  leaveAll(client: Socket): void {
    for (const [matchId, room] of this.rooms) {
      if (room.has(client)) {
        room.delete(client);
        if (room.size === 0) {
          this.rooms.delete(matchId);
        }
      }
    }
  }

  broadcast(matchId: string, message: Record<string, unknown>): void {
    const room = this.rooms.get(matchId);
    if (!room || room.size === 0) return;

    let sentCount = 0;
    for (const client of room) {
      try {
        if (client.connected) {
          client.emit('message', message);
          sentCount++;
        }
      } catch (err) {
        this.logger.warn(`Failed to send message to client ${client.id}`);
      }
    }
    this.logger.debug(`Broadcast to ${sentCount}/${room.size} clients in room ${matchId}`);
  }

  getRoomSize(matchId: string): number {
    return this.rooms.get(matchId)?.size ?? 0;
  }

  cleanup(matchId: string): void {
    const room = this.rooms.get(matchId);
    if (room) {
      this.logger.log(`Cleaning up room ${matchId} (${room.size} clients remaining)`);
      this.rooms.delete(matchId);
    }
  }
}
