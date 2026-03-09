import { Injectable, Logger } from '@nestjs/common';
import { TURN_TIMEOUT_MS } from '../common/constants/game.constants';
import { MoveRequest, MoveResponse, ChessMoveRequest, ChessMoveResponse } from '../common/types';
import { OpenClawClientService, OpenClawAgentInfo } from './openclaw-client.service';

export interface AgentInfo {
  endpointUrl: string;
  type?: string;
  openclawUrl?: string;
  openclawToken?: string;
  openclawAgentId?: string;
}

@Injectable()
export class AgentClientService {
  private readonly logger = new Logger(AgentClientService.name);
  private readonly timeoutMs: number;

  constructor(private readonly openclawClient: OpenClawClientService) {
    this.timeoutMs = TURN_TIMEOUT_MS;
  }

  async requestMove(endpointUrl: string, moveRequest: MoveRequest): Promise<MoveResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startTime = Date.now();

    this.logger.log(
      `Requesting move from agent at ${endpointUrl} (match: ${moveRequest.matchId}, move #${moveRequest.moveNumber})`,
    );

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(moveRequest),
        signal: controller.signal,
      });

      const elapsed = Date.now() - startTime;

      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable>');
        this.logger.error(
          `Agent returned HTTP ${response.status} (${elapsed}ms): ${body}`,
        );
        throw new Error(`Agent returned HTTP ${response.status}: ${body}`);
      }

      const data = (await response.json()) as MoveResponse;
      this.logger.log(`Agent responded with move [${data.move}] (${elapsed}ms)`);
      return data;
    } catch (error: unknown) {
      const elapsed = Date.now() - startTime;

      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted')))
      ) {
        this.logger.error(`Agent request timed out after ${elapsed}ms`);
        throw new Error(`Agent at ${endpointUrl} did not respond within ${this.timeoutMs}ms`);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent request failed (${elapsed}ms): ${message}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestReversiMoveFromOpenClaw(
    agent: AgentInfo,
    moveRequest: MoveRequest,
    context?: { side: 'a' | 'b'; agentId: string },
  ): Promise<MoveResponse> {
    const openclawAgent: OpenClawAgentInfo = {
      openclawUrl: agent.openclawUrl!,
      openclawToken: agent.openclawToken!,
      openclawAgentId: agent.openclawAgentId || 'main',
    };

    const result = await this.openclawClient.getReversiMove(openclawAgent, {
      matchId: moveRequest.matchId,
      board: moveRequest.board,
      yourPiece: moveRequest.yourPiece,
      legalMoves: moveRequest.legalMoves,
      moveNumber: moveRequest.moveNumber,
    }, context);

    this.logger.log(
      `OpenClaw reversi agent responded (source=${result.source}, match=${moveRequest.matchId})`,
    );

    return result.move as MoveResponse;
  }

  async requestChessMoveFromOpenClaw(
    agent: AgentInfo,
    moveRequest: ChessMoveRequest,
    context?: { side: 'a' | 'b'; agentId: string },
  ): Promise<ChessMoveResponse> {
    const openclawAgent: OpenClawAgentInfo = {
      openclawUrl: agent.openclawUrl!,
      openclawToken: agent.openclawToken!,
      openclawAgentId: agent.openclawAgentId || 'main',
    };

    const result = await this.openclawClient.getChessMove(openclawAgent, {
      matchId: moveRequest.matchId,
      fen: moveRequest.fen,
      board: moveRequest.board,
      yourColor: moveRequest.yourColor,
      legalMoves: moveRequest.legalMoves,
      moveNumber: moveRequest.moveNumber,
      isCheck: moveRequest.isCheck,
      moveHistory: moveRequest.moveHistory,
    }, context);

    this.logger.log(
      `OpenClaw chess agent responded (source=${result.source}, match=${moveRequest.matchId})`,
    );

    return result.move as ChessMoveResponse;
  }

  async requestPokerMoveFromOpenClaw(
    agent: AgentInfo,
    gameState: {
      matchId: string;
      handNumber: number;
      street: string;
      yourSeatIndex: number;
      yourHoleCards: { rank: string; suit: string }[];
      communityCards: { rank: string; suit: string }[];
      pot: number;
      yourStack: number;
      players: { seatIndex: number; name?: string; stack: number; currentBet: number; hasFolded: boolean; isAllIn: boolean }[];
      legalActions: { canFold: boolean; canCheck: boolean; canCall: boolean; callAmount: number; canRaise: boolean; minRaise: number; maxRaise: number; canAllIn: boolean; allInAmount: number };
      actionHistory: { type: string; amount?: number; playerIndex: number; street: string }[];
      blinds: { small: number; big: number };
      moveNumber: number;
    },
    context?: { side: 'a' | 'b'; agentId: string; pokerSeatIndex: number },
  ): Promise<{ action: string; amount?: number }> {
    const openclawAgent: OpenClawAgentInfo = {
      openclawUrl: agent.openclawUrl!,
      openclawToken: agent.openclawToken!,
      openclawAgentId: agent.openclawAgentId || 'main',
    };

    const result = await this.openclawClient.getPokerMove(openclawAgent, gameState, context);

    this.logger.log(
      `OpenClaw poker agent responded (source=${result.source}, match=${gameState.matchId})`,
    );

    return { action: result.action, amount: result.amount };
  }

  getOpenClawClient(): OpenClawClientService {
    return this.openclawClient;
  }
}
