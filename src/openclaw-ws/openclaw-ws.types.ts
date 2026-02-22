// ── Wire Protocol ──

export interface OpenClawRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface OpenClawResponseOk {
  type: 'res';
  id: string;
  ok: true;
  result?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface OpenClawResponseError {
  type: 'res';
  id: string;
  ok: false;
  error: { code: string; message: string };
}

export type OpenClawResponse = OpenClawResponseOk | OpenClawResponseError;

export interface OpenClawEvent {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
  seq?: number;
}

export type OpenClawMessage = OpenClawResponse | OpenClawEvent;

// ── Challenge ──

export interface ChallengePayload {
  nonce: string;
  ts: number;
}

// ── Connect Params ──

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
    instanceId: string;
  };
  role: string;
  scopes: string[];
  device: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
  caps: string[];
  auth: { token: string };
  locale: string;
}

// ── Client Options ──

export interface OpenClawWsClientOptions {
  url: string;
  token: string;
  reconnect?: boolean;
  reconnectDelay?: number;
}

// ── Method Params ──

export interface WakeParams {
  text: string;
  mode: 'now' | 'next-heartbeat';
}

export interface AgentParams {
  message: string;
  name?: string;
  agentId?: string;
  wakeMode?: 'now' | 'next-heartbeat';
  deliver?: boolean;
  channel?: string;
}

export interface ChatSendParams {
  message: string;
  sessionKey: string;
  idempotencyKey?: string;
}

// ── Connection State ──

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected';
