import { randomUUID } from 'node:crypto';
import * as crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type {
  OpenClawWsClientOptions,
  OpenClawEvent,
  OpenClawMessage,
  OpenClawResponse,
  OpenClawRequest,
  ChallengePayload,
  ConnectParams,
  ConnectionState,
  WakeParams,
  AgentParams,
  ChatSendParams,
} from './openclaw-ws.types';

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export class OpenClawWsClient extends EventEmitter {
  private options: Required<OpenClawWsClientOptions>;
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private pendingAgentRuns = new Map<string, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    events: Array<Record<string, unknown>>;
  }>();
  private devicePrivateKey!: crypto.KeyObject;
  private devicePublicKeyRaw!: Buffer;
  private deviceId!: string;
  private instanceId = randomUUID();
  private _state: ConnectionState = 'disconnected';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: OpenClawWsClientOptions) {
    super();
    this.options = {
      reconnect: true,
      reconnectDelay: 800,
      ...options,
    };
    this.generateDeviceKeys();
  }

  get state(): ConnectionState {
    return this._state;
  }

  // ── Key Generation ──

  private generateDeviceKeys(): void {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    this.devicePrivateKey = privateKey;

    const spki = publicKey.export({ type: 'spki', format: 'der' });
    this.devicePublicKeyRaw = spki.subarray(spki.length - 32);

    this.deviceId = crypto.createHash('sha256').update(this.devicePublicKeyRaw).digest('hex');
  }

  // ── Signature ──

  private sign(nonce: string): { signature: string; signedAt: number } {
    const signedAt = Date.now();
    const scopes = 'operator.admin,operator.approvals,operator.pairing';
    const message = `v2|${this.deviceId}|openclaw-control-ui|webchat|operator|${scopes}|${signedAt}|${this.options.token}|${nonce}`;
    const sig = crypto.sign(null, Buffer.from(message, 'utf8'), this.devicePrivateKey);
    return { signature: base64url(sig), signedAt };
  }

  // ── Connection ──

  connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    this.setState('connecting');
    const httpUrl = this.options.url.replace(/^ws/, 'http');

    this.ws = new WebSocket(this.options.url, {
      headers: { Origin: httpUrl },
    });

    this.ws.on('open', () => {
      this.setState('authenticating');
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data.toString());
    });

    this.ws.on('close', (code) => {
      this.setState('disconnected');
      this.rejectAllPending(new Error(`WebSocket closed (code ${code})`));
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  disconnect(): void {
    this.options.reconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  private setState(state: ConnectionState): void {
    this._state = state;
    this.emit('stateChange', state);
  }

  private scheduleReconnect(): void {
    if (!this.options.reconnect) return;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.options.reconnectDelay);
  }

  // ── Message Handling ──

  private handleMessage(raw: string): void {
    let msg: OpenClawMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'event') {
      this.handleEvent(msg as OpenClawEvent);
    } else if (msg.type === 'res') {
      this.handleResponse(msg as OpenClawResponse);
    }
  }

  private handleEvent(event: OpenClawEvent): void {
    if (event.event === 'connect.challenge') {
      const payload = event.payload as unknown as ChallengePayload;
      this.sendConnect(payload.nonce);
    }

    // Collect agent run events by runId
    const runId = event.payload?.runId as string | undefined;
    if (runId) {
      const pending = this.pendingAgentRuns.get(runId);
      if (pending) {
        pending.events.push({ ...event.payload, _event: event.event });

        const stream = event.payload?.stream as string | undefined;
        const data = event.payload?.data as Record<string, unknown> | undefined;
        const phase = data?.phase as string | undefined;
        const state = event.payload?.state as string | undefined;

        // Resolve on lifecycle error
        if (stream === 'lifecycle' && phase === 'error') {
          this.pendingAgentRuns.delete(runId);
          clearTimeout(pending.timer);
          const errorMsg = data?.error as string || data?.message as string || 'Agent run failed';
          pending.reject(new Error(errorMsg));
          return;
        }

        // Resolve on lifecycle complete/end/done — use last assistant event's data.text
        if (stream === 'lifecycle' && (phase === 'complete' || phase === 'end' || phase === 'done')) {
          this.pendingAgentRuns.delete(runId);
          clearTimeout(pending.timer);
          // Last assistant stream event has the full accumulated text in data.text
          const lastAssistant = [...pending.events].reverse().find((e) => e.stream === 'assistant');
          pending.resolve(lastAssistant ?? data ?? {});
          return;
        }
      }
    }

    this.emit('event', event);
    this.emit(`event:${event.event}`, event.payload);
  }

  private handleResponse(res: OpenClawResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) return;
    this.pending.delete(res.id);
    clearTimeout(pending.timer);

    if (res.ok) {
      pending.resolve(res.result ?? res.payload ?? {});
    } else {
      pending.reject(new Error(`${res.error.code}: ${res.error.message}`));
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
    for (const [id, pending] of this.pendingAgentRuns) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingAgentRuns.delete(id);
    }
  }

  // ── Connect Handshake ──

  private sendConnect(nonce: string): void {
    const { signature, signedAt } = this.sign(nonce);

    const params: ConnectParams = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'openclaw-control-ui',
        version: 'dev',
        platform: process.platform,
        mode: 'webchat',
        instanceId: this.instanceId,
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
      device: {
        id: this.deviceId,
        publicKey: base64url(this.devicePublicKeyRaw),
        signature,
        signedAt,
        nonce,
      },
      caps: [],
      auth: { token: this.options.token },
      locale: 'en',
    };

    this.send('connect', params as unknown as Record<string, unknown>)
      .then(() => {
        this.setState('connected');
        this.emit('connected');
      })
      .catch((err) => {
        this.emit('error', err);
        this.ws?.close();
      });
  }

  // ── RPC ──

  private send(method: string, params: Record<string, unknown>, timeoutMs = 15000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }

      const id = randomUUID();
      const req: OpenClawRequest = { type: 'req', id, method, params };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(req));
    });
  }

  waitForConnect(timeoutMs = 10000): Promise<void> {
    if (this._state === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('connected', onConnect);
        reject(new Error('Connection timed out'));
      }, timeoutMs);

      const onConnect = () => {
        clearTimeout(timer);
        resolve();
      };
      this.once('connected', onConnect);
    });
  }

  // ── Public API ──

  async wake(params: WakeParams): Promise<Record<string, unknown>> {
    return this.send('wake', params as unknown as Record<string, unknown>);
  }

  async agent(params: AgentParams): Promise<Record<string, unknown>> {
    const full = { idempotencyKey: randomUUID(), ...params };
    return this.send('agent', full as unknown as Record<string, unknown>);
  }

  /**
   * Send an agent request and wait for the completion event matching the runId.
   */
  async agentAndWait(params: AgentParams, timeoutMs = 90000): Promise<Record<string, unknown>> {
    const accepted = await this.agent(params);
    const runId = accepted.runId as string | undefined;
    if (!runId) {
      return accepted; // No runId means the response was already inline
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAgentRuns.delete(runId);
        reject(new Error(`Agent run ${runId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingAgentRuns.set(runId, { resolve, reject, timer, events: [] });
    });
  }

  async chatSend(params: ChatSendParams): Promise<Record<string, unknown>> {
    const full = { idempotencyKey: randomUUID(), ...params };
    return this.send('chat.send', full as unknown as Record<string, unknown>);
  }

  async health(): Promise<Record<string, unknown>> {
    return this.send('health', {});
  }

  async status(): Promise<Record<string, unknown>> {
    return this.send('status', {});
  }

  async configGet(): Promise<Record<string, unknown>> {
    return this.send('config.get', {});
  }
}
