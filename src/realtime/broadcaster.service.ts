import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  MatchStartedEvent,
  MatchMoveEvent,
  MatchTimeoutEvent,
  MatchEndedEvent,
  AgentThinkingEvent,
} from '../common/types';
import { EventBusService } from '../orchestrator/event-bus.service';
import { RoomsService } from './rooms.service';

@Injectable()
export class BroadcasterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BroadcasterService.name);
  private readonly handlers = new Map<string, (...args: unknown[]) => void>();

  constructor(
    private readonly rooms: RoomsService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    this.logger.log('Broadcaster starting, subscribing to match events');

    const onMatchStarted = (data: MatchStartedEvent): void => {
      this.rooms.broadcast(data.matchId, {
        type: 'match:start',
        data: {
          matchId: data.matchId,
          gameType: data.gameType,
          board: data.board,
        },
      });
    };

    const onMatchMove = (data: MatchMoveEvent): void => {
      this.rooms.broadcast(data.matchId, {
        type: 'match:move',
        data: {
          matchId: data.matchId,
          side: data.side,
          move: { row: data.move.row, col: data.move.col },
          boardState: data.boardState,
          score: { a: data.score.a, b: data.score.b },
          moveNumber: data.moveNumber,
          thinkingTimeMs: data.thinkingTimeMs,
        },
      });
    };

    const onMatchTimeout = (data: MatchTimeoutEvent): void => {
      this.rooms.broadcast(data.matchId, {
        type: 'match:timeout',
        data: {
          matchId: data.matchId,
          side: data.side,
          timeoutCount: data.timeoutCount,
        },
      });
    };

    const onMatchEnded = (data: MatchEndedEvent): void => {
      this.rooms.broadcast(data.matchId, {
        type: 'match:end',
        data: {
          matchId: data.matchId,
          result: {
            winnerId: data.result.winnerId,
            reason: data.result.reason,
            finalScore: { a: data.result.finalScore.a, b: data.result.finalScore.b },
            totalMoves: data.result.totalMoves,
          },
        },
      });
      this.rooms.cleanup(data.matchId);
    };

    const onAgentThinking = (data: AgentThinkingEvent): void => {
      this.rooms.broadcast(data.matchId, {
        type: 'agent:thinking',
        data: {
          matchId: data.matchId,
          side: data.side,
          agentId: data.agentId,
          raw: data.raw,
          moveNumber: data.moveNumber,
        },
      });
    };

    this.eventBus.on('match:started', onMatchStarted);
    this.eventBus.on('match:move', onMatchMove);
    this.eventBus.on('match:timeout', onMatchTimeout);
    this.eventBus.on('match:ended', onMatchEnded);
    this.eventBus.on('agent:thinking', onAgentThinking);

    this.handlers.set('match:started', onMatchStarted as (...args: unknown[]) => void);
    this.handlers.set('match:move', onMatchMove as (...args: unknown[]) => void);
    this.handlers.set('match:timeout', onMatchTimeout as (...args: unknown[]) => void);
    this.handlers.set('match:ended', onMatchEnded as (...args: unknown[]) => void);
    this.handlers.set('agent:thinking', onAgentThinking as (...args: unknown[]) => void);

    this.logger.log('Broadcaster started');
  }

  stop(): void {
    for (const [event, handler] of this.handlers) {
      this.eventBus.removeListener(event, handler);
    }
    this.handlers.clear();
    this.logger.log('Broadcaster stopped');
  }
}
