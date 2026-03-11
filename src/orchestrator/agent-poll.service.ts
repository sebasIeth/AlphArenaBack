import { Injectable, Logger } from '@nestjs/common';

export interface PendingTurn {
  matchId: string;
  gameType: string;
  side: 'a' | 'b';
  seatIndex?: number; // for poker N-player
  turnPayload: unknown;
  createdAt: number;
}

@Injectable()
export class AgentPollService {
  private readonly logger = new Logger(AgentPollService.name);
  private readonly pendingTurns = new Map<string, PendingTurn>();

  setTurnPayload(
    agentId: string,
    matchId: string,
    gameType: string,
    side: 'a' | 'b',
    turnPayload: unknown,
    seatIndex?: number,
  ): void {
    this.pendingTurns.set(agentId, {
      matchId,
      gameType,
      side,
      seatIndex,
      turnPayload,
      createdAt: Date.now(),
    });
    this.logger.log(`Turn payload set for agent ${agentId} (match=${matchId}, gameType=${gameType})`);
  }

  getTurnPayload(agentId: string): PendingTurn | undefined {
    return this.pendingTurns.get(agentId);
  }

  clearTurnPayload(agentId: string): void {
    this.pendingTurns.delete(agentId);
  }

  hasPendingTurn(agentId: string): boolean {
    return this.pendingTurns.has(agentId);
  }
}
