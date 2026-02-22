import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OpenClawWsClient } from './openclaw-ws.client';
import type { AgentParams, WakeParams } from './openclaw-ws.types';

interface CachedClient {
  client: OpenClawWsClient;
  lastUsed: number;
}

@Injectable()
export class OpenClawWsService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenClawWsService.name);
  private readonly clients = new Map<string, CachedClient>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Cleanup stale clients every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupStaleClients(), 5 * 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    for (const [key, entry] of this.clients) {
      entry.client.disconnect();
      this.clients.delete(key);
    }
  }

  private clientKey(url: string, token: string): string {
    return `${url}|${token}`;
  }

  private async getOrCreateClient(url: string, token: string): Promise<OpenClawWsClient> {
    const key = this.clientKey(url, token);
    const existing = this.clients.get(key);

    if (existing && existing.client.state === 'connected') {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    // Disconnect old client if exists but not connected
    if (existing) {
      existing.client.disconnect();
      this.clients.delete(key);
    }

    const client = new OpenClawWsClient({ url, token, reconnect: true });

    client.on('error', (err: Error) => {
      this.logger.warn(`OpenClaw WS error for ${url}: ${err.message}`);
    });

    client.connect();
    await client.waitForConnect(10000);

    this.clients.set(key, { client, lastUsed: Date.now() });
    this.logger.log(`OpenClaw WS connected to ${url}`);

    return client;
  }

  /**
   * Create a short-lived client for one-off tests (connect, execute, disconnect).
   */
  private async withTempClient<T>(url: string, token: string, fn: (client: OpenClawWsClient) => Promise<T>): Promise<T> {
    const client = new OpenClawWsClient({ url, token, reconnect: false });

    client.on('error', () => { /* suppress for temp clients */ });

    try {
      client.connect();
      await client.waitForConnect(10000);
      return await fn(client);
    } finally {
      client.disconnect();
    }
  }

  private cleanupStaleClients(): void {
    const now = Date.now();
    const maxAge = 10 * 60_000; // 10 minutes idle

    for (const [key, entry] of this.clients) {
      if (now - entry.lastUsed > maxAge) {
        this.logger.log(`Cleaning up stale OpenClaw WS client: ${key.split('|')[0]}`);
        entry.client.disconnect();
        this.clients.delete(key);
      }
    }
  }

  // ── URL Conversion ──

  private toWsUrl(httpUrl: string): string {
    return httpUrl
      .replace(/^https:\/\//i, 'wss://')
      .replace(/^http:\/\//i, 'ws://');
  }

  // ── Public API for tests (short-lived connections) ──

  async testWake(httpUrl: string, token: string): Promise<{ ok: boolean; latencyMs: number; response?: string; error?: string }> {
    const wsUrl = this.toWsUrl(httpUrl);
    const start = Date.now();
    try {
      const result = await this.withTempClient(wsUrl, token, (client) =>
        client.wake({ text: 'AlphArena health check', mode: 'now' }),
      );
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs, response: JSON.stringify(result).substring(0, 100) };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }

  async testHealth(httpUrl: string, token: string): Promise<{ ok: boolean; latencyMs: number; response?: string; error?: string }> {
    const wsUrl = this.toWsUrl(httpUrl);
    const start = Date.now();
    try {
      const result = await this.withTempClient(wsUrl, token, (client) =>
        client.health(),
      );
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs, response: JSON.stringify(result).substring(0, 50) };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }

  // ── Public API for game moves (persistent connections) ──

  async sendAgentChat(
    httpUrl: string,
    token: string,
    message: string,
    agentId?: string,
  ): Promise<string> {
    const wsUrl = this.toWsUrl(httpUrl);
    const params: AgentParams = { message };
    if (agentId) params.agentId = agentId;

    const client = await this.getOrCreateClient(wsUrl, token);
    const result = await client.agentAndWait(params);

    // Extract text from assistant stream event: { stream: "assistant", data: { text: "..." } }
    const data = result.data as Record<string, unknown> | undefined;
    if (data?.text && typeof data.text === 'string') return data.text;

    // Fallbacks for other possible shapes
    if (typeof result.text === 'string') return result.text;
    if (typeof result.content === 'string') return result.content;
    if (typeof result.result === 'string') return result.result;
    return JSON.stringify(result);
  }

  async sendAgentMessage(
    httpUrl: string,
    token: string,
    params: AgentParams,
  ): Promise<Record<string, unknown>> {
    const wsUrl = this.toWsUrl(httpUrl);
    const client = await this.getOrCreateClient(wsUrl, token);
    return client.agentAndWait(params);
  }

  async sendWake(
    httpUrl: string,
    token: string,
    params: WakeParams,
  ): Promise<Record<string, unknown>> {
    const wsUrl = this.toWsUrl(httpUrl);
    const client = await this.getOrCreateClient(wsUrl, token);
    return client.wake(params);
  }
}
