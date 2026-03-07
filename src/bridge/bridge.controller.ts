import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { BridgeService } from './bridge.service';

@Controller('bridge')
export class BridgeController {
  constructor(private readonly bridge: BridgeService) {}

  @Get('agents')
  listAgents() {
    return this.bridge.listAgents();
  }

  @Post('agents/:agentId/ping')
  ping(@Param('agentId') agentId: string) {
    return this.bridge.ping(agentId);
  }

  @Post('agents/:agentId/wake')
  wake(@Param('agentId') agentId: string) {
    return this.bridge.wakeAgent(agentId);
  }

  @Post('agents/:agentId/move')
  getMove(@Param('agentId') agentId: string, @Body('prompt') prompt: string) {
    return this.bridge.getGameMove(agentId, prompt);
  }

  @Get('agents/:agentId/status')
  isOnline(@Param('agentId') agentId: string) {
    return this.bridge.isOnline(agentId);
  }
}
