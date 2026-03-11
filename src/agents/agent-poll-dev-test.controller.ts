import { Controller, Get, Post, Param, Body, HttpCode, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes } from 'crypto';
import { AgentPollService } from '../orchestrator/agent-poll.service';
import { HumanMoveService } from '../orchestrator/human-move.service';
import { Agent } from '../database/schemas';

/**
 * DEV-ONLY controller (no auth guard) for testing the agent polling flow.
 * In production this should be removed or guarded.
 */
@Controller('agent-poll-dev')
export class AgentPollDevTestController {
  private readonly logger = new Logger(AgentPollDevTestController.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    private readonly agentPollService: AgentPollService,
    private readonly humanMoveService: HumanMoveService,
  ) {}

  /**
   * GET /agent-poll-dev/setup
   * Finds or creates a test openclaw agent and returns its ID + pollingApiKey
   */
  @Get('setup')
  async setup() {
    // Find existing test agent
    let agent = await this.agentModel.findOne({ name: '__poll_test_agent__', type: 'openclaw' });

    if (!agent) {
      // Create a minimal test agent
      agent = await this.agentModel.create({
        userId: '000000000000000000000000', // dummy
        name: '__poll_test_agent__',
        type: 'openclaw',
        status: 'idle',
        chain: 'base',
        gameTypes: ['chess', 'poker'],
        eloRating: 1200,
        pollingApiKey: `agent_${randomBytes(32).toString('hex')}`,
        stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0 },
      });
      this.logger.log(`Created test agent: ${agent._id}`);
    }

    // Ensure it has a pollingApiKey
    if (!agent.pollingApiKey) {
      agent.pollingApiKey = `agent_${randomBytes(32).toString('hex')}`;
      await agent.save();
    }

    return {
      agentId: agent._id.toString(),
      pollingApiKey: agent.pollingApiKey,
      status: agent.status,
      instructions: {
        step1_poll: `GET /agent-poll/${agent._id}/poll  (with X-Agent-Api-Key header)`,
        step2_startTest: `POST /agent-poll-dev/start-test/${agent._id}`,
        step3_poll_again: `GET /agent-poll/${agent._id}/poll  → should show waiting_for_move`,
        step4_submitMove: `POST /agent-poll/${agent._id}/move  (with body)`,
      },
    };
  }

  /**
   * POST /agent-poll-dev/start-test/:id
   * Sets a fake chess turn for the agent and waits 30s for a move submission.
   */
  @Post('start-test/:id')
  @HttpCode(200)
  async startTest(@Param('id') id: string) {
    const agent = await this.agentModel.findById(id);
    if (!agent) throw new BadRequestException('Agent not found');

    const agentId = agent._id.toString();
    const fakeMatchId = 'test-match-' + Date.now();

    const fakeTurnPayload = {
      matchId: fakeMatchId,
      gameType: 'chess',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      board: [],
      yourColor: 'white',
      legalMoves: ['e2e4', 'd2d4', 'g1f3', 'b1c3'],
      moveNumber: 1,
      timeRemainingMs: 30000,
      isCheck: false,
      moveHistory: [],
    };

    this.agentPollService.setTurnPayload(agentId, fakeMatchId, 'chess', 'a', fakeTurnPayload);
    this.logger.log(`Dev test started for agent ${agentId} (matchId=${fakeMatchId})`);

    try {
      const move = await this.humanMoveService.waitForMove(fakeMatchId, 'a', agentId, 30_000);

      return {
        success: true,
        message: 'Round-trip test passed!',
        fakeMatchId,
        submittedMove: move,
      };
    } catch {
      this.agentPollService.clearTurnPayload(agentId);

      return {
        success: false,
        message: 'Test timed out after 30s. Submit a move via POST /agent-poll/:id/move before timeout.',
        fakeMatchId,
      };
    }
  }
}
