import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '../common/config/config.service';
import { RoomsService } from './rooms.service';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/ws',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly rooms: RoomsService,
  ) {}

  handleConnection(client: Socket): void {
    const token = client.handshake.query.token as string | undefined;

    if (!token) {
      client.emit('message', {
        type: 'error',
        data: { message: 'Authentication required. Pass ?token=<jwt> as a query parameter.' },
      });
      client.disconnect();
      return;
    }

    try {
      const payload = jwt.verify(token, this.configService.jwtSecret) as { userId: string; username: string };
      (client as any).user = payload;
      this.logger.log(`Client ${client.id} connected (user: ${payload.username})`);
    } catch {
      client.emit('message', {
        type: 'error',
        data: { message: 'Invalid or expired authentication token.' },
      });
      client.disconnect();
      return;
    }

    // Auto-join match room if matchId provided in query
    const matchId = client.handshake.query.matchId as string | undefined;
    if (matchId) {
      this.rooms.join(matchId, client);
      client.emit('message', {
        type: 'match:state',
        data: {
          matchId,
          subscribed: true,
          viewers: this.rooms.getRoomSize(matchId),
        },
      });
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client ${client.id} disconnected, cleaning up rooms`);
    this.rooms.leaveAll(client);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ): void {
    if (!data?.matchId) {
      client.emit('message', {
        type: 'error',
        data: { message: 'matchId is required for subscribe.' },
      });
      return;
    }

    this.rooms.join(data.matchId, client);
    this.logger.log(`Client ${client.id} subscribed to match ${data.matchId}`);
    client.emit('message', {
      type: 'match:state',
      data: {
        matchId: data.matchId,
        subscribed: true,
        viewers: this.rooms.getRoomSize(data.matchId),
      },
    });
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ): void {
    if (!data?.matchId) return;
    this.rooms.leave(data.matchId, client);
    this.logger.log(`Client ${client.id} unsubscribed from match ${data.matchId}`);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    client.emit('message', {
      type: 'pong',
      data: { timestamp: Date.now() },
    });
  }
}
