import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '../common/config/config.service';
import { RoomsService } from './rooms.service';
import { HumanMoveService } from '../orchestrator/human-move.service';
import { Agent } from '../database/schemas';

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
    private readonly humanMoveService: HumanMoveService,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
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
      this.rooms.registerClient(client);
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
    this.rooms.unregisterClient(client);
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

  @SubscribeMessage('game:move')
  async handleGameMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string; move: unknown },
  ): Promise<void> {
    const user = (client as any).user as { userId: string; username: string } | undefined;
    if (!user) {
      client.emit('message', { type: 'error', data: { message: 'Not authenticated.' } });
      return;
    }

    if (!data?.matchId || data.move === undefined) {
      client.emit('message', { type: 'error', data: { message: 'matchId and move are required.' } });
      return;
    }

    // Find the user's human agent that is currently playing in this match
    const pendingAgentId = this.humanMoveService.getPendingAgentId(data.matchId);
    if (!pendingAgentId) {
      client.emit('message', { type: 'error', data: { message: 'No pending move for this match.' } });
      return;
    }

    // Verify the user owns the agent
    const agent = await this.agentModel.findById(pendingAgentId);
    if (!agent || agent.userId.toString() !== user.userId || agent.type !== 'human') {
      client.emit('message', { type: 'error', data: { message: 'You are not the human player in this match.' } });
      return;
    }

    const submitted = this.humanMoveService.submitMove(data.matchId, pendingAgentId, data.move);
    if (submitted) {
      client.emit('message', { type: 'game:move_accepted', data: { matchId: data.matchId } });
    } else {
      client.emit('message', { type: 'error', data: { message: 'Failed to submit move.' } });
    }
  }
}
