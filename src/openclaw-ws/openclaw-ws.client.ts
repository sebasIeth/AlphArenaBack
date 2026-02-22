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
    return this.send('agent', params as unknown as Record<string, unknown>);
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
