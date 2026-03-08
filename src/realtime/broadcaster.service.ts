import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  MatchStartedEvent,
  MatchMoveEvent,
  MatchTimeoutEvent,
  MatchEndedEvent,
  AgentThinkingEvent,
  MatchmakingCountdownEvent,
  MatchmakingMatchedEvent,
  MatchYourTurnEvent,
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
      const payload: Record<string, unknown> = {
        matchId: data.matchId,
        gameType: data.gameType,
        board: data.board,
      };
      if (data.assam) payload.assam = data.assam;
      if (data.players) payload.players = data.players;
      if (data.fen) payload.fen = data.fen;
      // Poker-specific
      if (data.pokerPlayerStacks) payload.pokerPlayerStacks = data.pokerPlayerStacks;
      if (data.pokerHandNumber != null) payload.pokerHandNumber = data.pokerHandNumber;
      // Poker N-player
      if (data.pokerPlayers) payload.pokerPlayers = data.pokerPlayers;
      this.rooms.broadcast(data.matchId, { type: 'match:start', data: payload });
    };

    const onMatchMove = (data: MatchMoveEvent): void => {
      const payload: Record<string, unknown> = {
        matchId: data.matchId,
        side: data.side,
        move: { row: data.move.row, col: data.move.col },
        boardState: data.boardState,
        score: { a: data.score.a, b: data.score.b },
        moveNumber: data.moveNumber,
        thinkingTimeMs: data.thinkingTimeMs,
      };
      // Marrakech-specific fields
      if (data.assam) payload.assam = data.assam;
      if (data.diceResult) payload.diceResult = data.diceResult;
      if (data.movePath) payload.movePath = data.movePath;
      if (data.phase) payload.phase = data.phase;
      if (data.tribute !== undefined) payload.tribute = data.tribute;
      if (data.players) payload.players = data.players;
      // Chess-specific fields
      if (data.chessMove) payload.chessMove = data.chessMove;
      if (data.fen) payload.fen = data.fen;
      if (data.isCheck !== undefined) payload.isCheck = data.isCheck;
      // Poker-specific fields
      if (data.pokerAction) payload.pokerAction = data.pokerAction;
      if (data.pokerStreet) payload.pokerStreet = data.pokerStreet;
      if (data.pokerPot != null) payload.pokerPot = data.pokerPot;
      if (data.pokerCommunityCards) payload.pokerCommunityCards = data.pokerCommunityCards;
      if (data.pokerPlayerStacks) payload.pokerPlayerStacks = data.pokerPlayerStacks;
      if (data.pokerHandNumber != null) payload.pokerHandNumber = data.pokerHandNumber;
      // Poker N-player
      if (data.pokerPlayers) payload.pokerPlayers = data.pokerPlayers;
      if (data.pokerPlayerIndex != null) payload.pokerPlayerIndex = data.pokerPlayerIndex;
      this.rooms.broadcast(data.matchId, { type: 'match:move', data: payload });
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

    const onMatchmakingCountdown = (data: MatchmakingCountdownEvent): void => {
      this.rooms.broadcastAll({
        type: 'matchmaking:countdown',
        data: {
          gameType: data.gameType,
          remainingMs: data.remainingMs,
          agents: data.agents,
        },
      });
    };

    const onMatchmakingMatched = (data: MatchmakingMatchedEvent): void => {
      this.rooms.broadcastAll({
        type: 'matchmaking:matched',
        data: {
          matchId: data.matchId,
          gameType: data.gameType,
          agents: data.agents,
        },
      });
    };

    const onMatchYourTurn = (data: MatchYourTurnEvent): void => {
      const ytPayload: Record<string, unknown> = {
        matchId: data.matchId,
        side: data.side,
        gameType: data.gameType,
        board: data.board,
        legalMoves: data.legalMoves,
        fen: data.fen,
        moveNumber: data.moveNumber,
        timeRemainingMs: data.timeRemainingMs,
        turnTimeoutMs: data.turnTimeoutMs,
      };
      // Poker-specific
      if (data.pokerHoleCards) ytPayload.pokerHoleCards = data.pokerHoleCards;
      if (data.pokerCommunityCards) ytPayload.pokerCommunityCards = data.pokerCommunityCards;
      if (data.pokerPot != null) ytPayload.pokerPot = data.pokerPot;
      if (data.pokerPlayerStacks) ytPayload.pokerPlayerStacks = data.pokerPlayerStacks;
      if (data.pokerStreet) ytPayload.pokerStreet = data.pokerStreet;
      if (data.pokerHandNumber != null) ytPayload.pokerHandNumber = data.pokerHandNumber;
      if (data.pokerIsDealer != null) ytPayload.pokerIsDealer = data.pokerIsDealer;
      if (data.pokerActionHistory) ytPayload.pokerActionHistory = data.pokerActionHistory;
      // Poker N-player
      if (data.pokerPlayers) ytPayload.pokerPlayers = data.pokerPlayers;
      if (data.pokerSeatIndex != null) ytPayload.pokerSeatIndex = data.pokerSeatIndex;
      if (data.pokerCurrentPlayerIndex != null) ytPayload.pokerCurrentPlayerIndex = data.pokerCurrentPlayerIndex;
      this.rooms.broadcast(data.matchId, { type: 'match:your_turn', data: ytPayload });
    };

    this.eventBus.on('match:started', onMatchStarted);
    this.eventBus.on('match:move', onMatchMove);
    this.eventBus.on('match:timeout', onMatchTimeout);
    this.eventBus.on('match:ended', onMatchEnded);
    this.eventBus.on('agent:thinking', onAgentThinking);
    this.eventBus.on('matchmaking:countdown', onMatchmakingCountdown);
    this.eventBus.on('matchmaking:matched', onMatchmakingMatched);
    this.eventBus.on('match:your_turn', onMatchYourTurn);

    this.handlers.set('match:started', onMatchStarted as (...args: unknown[]) => void);
    this.handlers.set('match:move', onMatchMove as (...args: unknown[]) => void);
    this.handlers.set('match:timeout', onMatchTimeout as (...args: unknown[]) => void);
    this.handlers.set('match:ended', onMatchEnded as (...args: unknown[]) => void);
    this.handlers.set('agent:thinking', onAgentThinking as (...args: unknown[]) => void);
    this.handlers.set('matchmaking:countdown', onMatchmakingCountdown as (...args: unknown[]) => void);
    this.handlers.set('matchmaking:matched', onMatchmakingMatched as (...args: unknown[]) => void);
    this.handlers.set('match:your_turn', onMatchYourTurn as (...args: unknown[]) => void);

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
