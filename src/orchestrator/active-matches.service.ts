import { Injectable, Logger } from '@nestjs/common';
import { GameState, PlayerColor } from '../common/types';

export interface MatchClockInterface {
  startMatch(): void;
  startTurn(): number;
  clearTurn(): void;
  stop(): void;
  getTimeRemainingMs(): number;
}

export interface ActiveMatchState {
  matchId: string;
  gameState: GameState;
  clock: MatchClockInterface | null;
  turnDeadline: number;
  timeouts: { a: number; b: number };
  status: 'starting' | 'active';
  agents: {
    a: { agentId: string; endpointUrl: string; piece: PlayerColor; walletAddress?: string };
    b: { agentId: string; endpointUrl: string; piece: PlayerColor; walletAddress?: string };
  };
  startedAt: number;
}

@Injectable()
export class ActiveMatchesService {
  private readonly logger = new Logger(ActiveMatchesService.name);
  private readonly matches = new Map<string, ActiveMatchState>();

  get size(): number {
    return this.matches.size;
  }

  getMatch(matchId: string): ActiveMatchState | undefined {
    return this.matches.get(matchId);
  }

  addMatch(state: ActiveMatchState): void {
    if (this.matches.has(state.matchId)) {
      throw new Error(`Match ${state.matchId} is already in the active matches map.`);
    }
    this.matches.set(state.matchId, state);
  }

  removeMatch(matchId: string): boolean {
    return this.matches.delete(matchId);
  }

  updateMatch(matchId: string, updates: Partial<ActiveMatchState>): ActiveMatchState {
    const existing = this.matches.get(matchId);
    if (!existing) {
      throw new Error(`Match ${matchId} not found in active matches.`);
    }
    const updated: ActiveMatchState = { ...existing, ...updates };
    this.matches.set(matchId, updated);
    return updated;
  }

  getAllMatchIds(): string[] {
    return [...this.matches.keys()];
  }

  entries(): IterableIterator<[string, ActiveMatchState]> {
    return this.matches.entries();
  }

  clear(): void {
    this.matches.clear();
  }
}
