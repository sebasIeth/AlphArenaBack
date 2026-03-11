import {
  Controller, Get, Post, Param, Body, UseGuards,
  BadRequestException, ForbiddenException, HttpCode, Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IsString, IsOptional, MinLength, IsObject, Allow } from 'class-validator';
import { AgentApiKeyGuard } from '../common/guards/agent-api-key.guard';
import { CurrentAgent } from '../common/decorators/current-agent.decorator';
import { AgentPollService } from '../orchestrator/agent-poll.service';
import { HumanMoveService } from '../orchestrator/human-move.service';
import { ActiveMatchesService } from '../orchestrator/active-matches.service';
import { Agent } from '../database/schemas';

class SubmitMoveDto {
  @IsString()
  @MinLength(1)
  matchId: string;

  @IsOptional()
  @Allow()
  move: unknown;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  amount?: number;
}

@Controller('agent-poll')
@UseGuards(AgentApiKeyGuard)
export class AgentPollController {
  private readonly logger = new Logger(AgentPollController.name);

  constructor(
    private readonly agentPollService: AgentPollService,
    private readonly humanMoveService: HumanMoveService,
    private readonly activeMatches: ActiveMatchesService,
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
  ) {}

  @Get(':id/poll')
  poll(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
  ) {
    if (agent._id.toString() !== id) {
      throw new ForbiddenException('API key does not match agent ID');
    }

    const agentId = agent._id.toString();

    // Check if there's a pending turn for this agent
    const pendingTurn = this.agentPollService.getTurnPayload(agentId);
    if (pendingTurn) {
      return {
        status: 'waiting_for_move',
        matchId: pendingTurn.matchId,
        gameType: pendingTurn.gameType,
        side: pendingTurn.side,
        seatIndex: pendingTurn.seatIndex,
        turnPayload: pendingTurn.turnPayload,
      };
    }

    // Return the agent's DB status
    const status = agent.status as string;

    if (status === 'in_match') {
      // In a match but not their turn yet
      return { status: 'in_match' };
    }

    return { status };
  }

  @Post(':id/move')
  @HttpCode(200)
  submitMove(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
    @Body() dto: SubmitMoveDto,
  ) {
    if (agent._id.toString() !== id) {
      throw new ForbiddenException('API key does not match agent ID');
    }

    const agentId = agent._id.toString();
    const pendingTurn = this.agentPollService.getTurnPayload(agentId);

    if (!pendingTurn) {
      throw new BadRequestException('No pending turn for this agent');
    }

    if (pendingTurn.matchId !== dto.matchId) {
      throw new BadRequestException('matchId does not match the pending turn');
    }

    // Build the move payload based on gameType
    let movePayload: unknown;

    if (pendingTurn.gameType === 'poker') {
      // Poker expects { action, amount? }
      movePayload = {
        action: dto.action ?? (dto.move as any)?.action,
        amount: dto.amount ?? (dto.move as any)?.amount,
      };
    } else {
      // Chess, reversi, marrakech - pass the move as-is
      movePayload = dto.move;
    }

    // Clear the pending turn
    this.agentPollService.clearTurnPayload(agentId);

    // Submit to HumanMoveService (same promise resolution mechanism)
    const submitted = this.humanMoveService.submitMove(
      dto.matchId,
      agentId,
      movePayload,
    );

    if (!submitted) {
      throw new BadRequestException(
        'Failed to submit move. The turn may have timed out or the match ended.',
      );
    }

    return { success: true };
  }

  /**
   * Test endpoint: sets a fake chess turn payload, then waits up to 30s
   * for the agent to poll and submit a move via POST /agent-poll/:id/move.
   *
   * Flow:
   * 1. Call POST /agent-poll/:id/test  (this endpoint - starts the test)
   * 2. Call GET  /agent-poll/:id/poll  (agent sees status: waiting_for_move)
   * 3. Call POST /agent-poll/:id/move  (agent submits { matchId: "test-match", move: { move: "e2e4" } })
   * 4. This endpoint returns the submitted move
   */
  @Post(':id/test')
  @HttpCode(200)
  async testRoundTrip(
    @CurrentAgent() agent: Agent,
    @Param('id') id: string,
  ) {
    if (agent._id.toString() !== id) {
      throw new ForbiddenException('API key does not match agent ID');
    }

    const agentId = agent._id.toString();
    const fakeMatchId = 'test-match-' + Date.now();

    // Set a fake chess turn payload that the agent will see when polling
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

    this.logger.log(`Test round-trip started for agent ${agentId} (fakeMatchId=${fakeMatchId})`);

    // Now wait for the agent to submit a move (via POST /agent-poll/:id/move)
    // We use HumanMoveService with a 30s timeout
    try {
      const move = await this.humanMoveService.waitForMove(fakeMatchId, 'a', agentId, 30_000);

      this.logger.log(`Test round-trip completed for agent ${agentId}: ${JSON.stringify(move)}`);

      return {
        success: true,
        message: 'Round-trip test passed! The agent polled and submitted a move.',
        fakeMatchId,
        submittedMove: move,
      };
    } catch {
      // Cleanup on timeout
      this.agentPollService.clearTurnPayload(agentId);

      return {
        success: false,
        message: 'Test timed out after 30s. The agent did not submit a move. Steps: 1) POST /test, 2) GET /poll to see the turn, 3) POST /move with the move.',
        fakeMatchId,
      };
    }
  }
}
