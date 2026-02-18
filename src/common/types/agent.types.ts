export type AgentStatus = 'idle' | 'queued' | 'in_match' | 'disabled';

export interface AgentStats {
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  winRate: number;
  totalEarnings: number;
}
