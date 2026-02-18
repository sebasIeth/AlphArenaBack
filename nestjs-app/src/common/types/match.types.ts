export type MatchStatus = 'starting' | 'active' | 'completed' | 'cancelled' | 'error';
export type MatchResultReason = 'score' | 'timeout' | 'forfeit' | 'disconnect' | 'draw';

export interface MatchAgent {
  agentId: string;
  userId: string;
  name: string;
  eloAtStart: number;
}

export interface MatchResult {
  winnerId: string | null;
  reason: MatchResultReason;
  finalScore: { a: number; b: number };
  totalMoves: number;
  eloChange: { a: number; b: number };
}
