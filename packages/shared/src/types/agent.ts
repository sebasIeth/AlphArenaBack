export type AgentStatus = "idle" | "queued" | "in_match" | "disabled";

export interface AgentStats {
  wins: number;
  losses: number;
  draws: number;
  totalMatches: number;
  winRate: number;
  totalEarnings: number;
}

export interface Agent {
  id: string;
  userId: string;
  name: string;
  endpointUrl: string;
  eloRating: number;
  stats: AgentStats;
  status: AgentStatus;
  gameTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentConfig {
  name: string;
  endpointUrl: string;
  gameTypes: string[];
}

export interface CreateAgentInput {
  name: string;
  endpointUrl: string;
  gameTypes: string[];
}

export interface UpdateAgentInput {
  name?: string;
  endpointUrl?: string;
  gameTypes?: string[];
}
