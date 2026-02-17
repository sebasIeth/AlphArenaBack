export type MatchStatus = "starting" | "active" | "completed" | "cancelled" | "error";

export type MatchResultReason = "score" | "timeout" | "forfeit" | "disconnect" | "draw";

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

export interface Match {
  id: string;
  gameType: string;
  agents: { a: MatchAgent; b: MatchAgent };
  stakeAmount: number;
  potAmount: number;
  status: MatchStatus;
  result: MatchResult | null;
  currentBoard: number[][];
  currentTurn: "a" | "b";
  moveCount: number;
  timeouts: { a: number; b: number };
  txHashes: { escrow: string | null; payout: string | null };
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MoveRecord {
  id: string;
  matchId: string;
  agentId: string;
  side: "a" | "b";
  moveNumber: number;
  moveData: { row: number; col: number };
  boardStateAfter: number[][];
  scoreAfter: { a: number; b: number };
  thinkingTimeMs: number;
  timestamp: Date;
}
