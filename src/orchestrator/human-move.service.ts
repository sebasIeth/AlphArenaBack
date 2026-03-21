import { Injectable, Logger } from '@nestjs/common';
import { TURN_TIMEOUT_MS } from '../common/constants/game.constants';

interface PendingMove {
  resolve: (move: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  side: string;
  agentId: string;
}

@Injectable()
export class HumanMoveService {
  private readonly logger = new Logger(HumanMoveService.name);
  private readonly pendingMoves = new Map<string, PendingMove>();

  waitForMove(matchId: string, side: string, agentId: string, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Clean up any existing pending move for this match
      this.cancelPending(matchId);

      const timeout = timeoutMs ?? TURN_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.pendingMoves.delete(matchId);
        reject(new Error(`Human move timeout for match ${matchId}`));
      }, timeout);

      this.pendingMoves.set(matchId, { resolve, reject, timer, side, agentId });
      this.logger.log(`Waiting for human move: match=${matchId}, side=${side}`);
    });
  }

  submitMove(matchId: string, agentId: string, move: unknown): boolean {
    const pending = this.pendingMoves.get(matchId);
    if (!pending) {
      this.logger.warn(`No pending move for match ${matchId}`);
      return false;
    }

    if (pending.agentId !== agentId) {
      this.logger.warn(`Agent ${agentId} is not the expected player for match ${matchId} (expected ${pending.agentId})`);
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingMoves.delete(matchId);
    pending.resolve(move);
    this.logger.log(`Human move submitted for match ${matchId}`);
    return true;
  }

  cancelPending(matchId: string): void {
    const pending = this.pendingMoves.get(matchId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingMoves.delete(matchId);
      this.logger.log(`Pending human move cancelled for match ${matchId}`);
    }
  }

  hasPending(matchId: string): boolean {
    return this.pendingMoves.has(matchId);
  }

  getPendingSide(matchId: string): string | null {
    return this.pendingMoves.get(matchId)?.side ?? null;
  }

  getPendingAgentId(matchId: string): string | null {
    return this.pendingMoves.get(matchId)?.agentId ?? null;
  }
}
