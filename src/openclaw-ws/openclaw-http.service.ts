import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

interface CachedSession {
  cookie: string;
  lastUsed: number;
  baseUrl: string;
}

@Injectable()
export class OpenClawHttpService implements OnModuleDestroy {
  private readonly logger = new Logger(OpenClawHttpService.name);
  private readonly sessions = new Map<string, CachedSession>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 5 * 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
  }

  private sessionKey(url: string, token: string): string {
    return `${url}|${token}`;
  }

  /**
   * Login to OpenClaw via POST /login and get session cookie.
   */
  private async login(baseUrl: string, token: string): Promise<string> {
    const url = `${baseUrl}/login`;
    const body = `token=${encodeURIComponent(token)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual', // Don't follow the 302
      signal: AbortSignal.timeout(10000),
    });

    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error(`Login failed: no session cookie returned (HTTP ${response.status})`);
    }

    // Extract connect.sid cookie
    const match = setCookie.match(/connect\.sid=[^;]+/);
    if (!match) {
      throw new Error('Login failed: could not extract session cookie');
    }

    this.logger.log(`OpenClaw login successful for ${baseUrl}`);
    return match[0];
  }

  /**
   * Get or create a session cookie for the given OpenClaw instance.
   */
  private async getSession(baseUrl: string, token: string): Promise<string> {
    const key = this.sessionKey(baseUrl, token);
    const existing = this.sessions.get(key);

    // Reuse session if less than 30 minutes old
    if (existing && Date.now() - existing.lastUsed < 30 * 60_000) {
      existing.lastUsed = Date.now();
      return existing.cookie;
    }

    const cookie = await this.login(baseUrl, token);
    this.sessions.set(key, { cookie, lastUsed: Date.now(), baseUrl });
    return cookie;
  }

  /**
   * Invalidate a session (e.g. on 403 response) and re-login.
   */
  private async refreshSession(baseUrl: string, token: string): Promise<string> {
    const key = this.sessionKey(baseUrl, token);
    this.sessions.delete(key);
    return this.getSession(baseUrl, token);
  }

  private cleanupStaleSessions(): void {
    const now = Date.now();
    const maxAge = 30 * 60_000;
    for (const [key, session] of this.sessions) {
      if (now - session.lastUsed > maxAge) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Make an authenticated request to an OpenClaw endpoint.
   * Handles session login automatically and retries on 403.
   */
  private async request(
    baseUrl: string,
    token: string,
    path: string,
    options: { method: string; body?: unknown; timeoutMs?: number },
  ): Promise<{ status: number; data: unknown }> {
    const url = `${baseUrl}${path}`;
    const timeout = options.timeoutMs || 30000;

    // Get session cookie
    let cookie = await this.getSession(baseUrl, token);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cookie': cookie,
    };

    let response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    // If 403, refresh session and retry once
    if (response.status === 403) {
      this.logger.warn(`Got 403 from ${path}, refreshing session...`);
      cookie = await this.refreshSession(baseUrl, token);
      headers['Cookie'] = cookie;

      response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return { status: response.status, data };
  }

  // ── Public API for tests ──

  async testWake(openclawUrl: string, token: string): Promise<{ ok: boolean; latencyMs: number; response?: string; error?: string }> {
    const baseUrl = openclawUrl.replace(/\/$/, '');
    const start = Date.now();

    try {
      const result = await this.request(baseUrl, token, '/hooks/wake', {
        method: 'POST',
        body: { text: 'AlphArena health check', mode: 'now' },
        timeoutMs: 30000,
      });
      const latencyMs = Date.now() - start;

      if (result.status >= 200 && result.status < 300) {
        const respStr = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        return { ok: true, latencyMs, response: respStr.substring(0, 100) };
      }

      return { ok: false, latencyMs, error: `HTTP ${result.status}: ${JSON.stringify(result.data).substring(0, 100)}` };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }

  async testHealth(openclawUrl: string, token: string): Promise<{ ok: boolean; latencyMs: number; response?: string; error?: string }> {
    // Use /hooks/wake as health check since OpenClaw doesn't have a dedicated health endpoint
    return this.testWake(openclawUrl, token);
  }

  // ── Public API for game moves ──

  async sendAgentMessage(
    openclawUrl: string,
    token: string,
    message: string,
    agentId?: string,
  ): Promise<string> {
    const baseUrl = openclawUrl.replace(/\/$/, '');

    const body: Record<string, unknown> = { message };
    if (agentId) body.agentId = agentId;

    const result = await this.request(baseUrl, token, '/hooks/agent', {
      method: 'POST',
      body,
      timeoutMs: 25000,
    });

    if (result.status >= 200 && result.status < 300) {
      if (typeof result.data === 'string') return result.data;
      const obj = result.data as Record<string, unknown>;
      if (obj.content) return String(obj.content);
      if (obj.message) return String(obj.message);
      if (obj.text) return String(obj.text);
      if (obj.result) return typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result);
      return JSON.stringify(result.data);
    }

    throw new Error(`OpenClaw /hooks/agent returned ${result.status}: ${JSON.stringify(result.data).substring(0, 100)}`);
  }
}
