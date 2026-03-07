import { Injectable, HttpException, Logger } from '@nestjs/common';

@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);
  private readonly bridgeUrl = process.env.BRIDGE_SERVER_URL || 'http://localhost:3002';

  async ping(agentId: string) {
    const res = await fetch(`${this.bridgeUrl}/agents/${agentId}/ping`, {
      method: 'POST',
    });
    if (!res.ok) {
      const body = await res.json();
      throw new HttpException(body.error || 'Ping failed', res.status);
    }
    return res.json();
  }

  async sendCommand(agentId: string, command: string, payload: Record<string, unknown> = {}, timeout = 30000) {
    const res = await fetch(`${this.bridgeUrl}/agents/${agentId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, payload, timeout }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new HttpException(body.error || 'Command failed', res.status);
    }
    return res.json();
  }

  async getGameMove(agentId: string, prompt: string) {
    return this.sendCommand(agentId, 'agent_chat', { message: prompt }, 90000);
  }

  async wakeAgent(agentId: string) {
    return this.sendCommand(agentId, 'wake', { text: 'Preparing for match', mode: 'now' });
  }

  async listAgents() {
    const res = await fetch(`${this.bridgeUrl}/agents`);
    return res.json();
  }

  async isOnline(agentId: string): Promise<boolean> {
    const res = await fetch(`${this.bridgeUrl}/agents/${agentId}/status`);
    if (res.status === 404) return false;
    const data = await res.json();
    return data.status === 'online';
  }
}
