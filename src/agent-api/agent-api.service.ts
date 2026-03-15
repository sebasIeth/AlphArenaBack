import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomBytes, createHash, randomUUID } from 'crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Agent, Match } from '../database/schemas';
import { ActiveMatchesService } from '../orchestrator/active-matches.service';
import { HumanMoveService } from '../orchestrator/human-move.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { MatchManagerService } from '../orchestrator/match-manager.service';
import { getLegalActions } from '../game-engine/poker';
import { RegisterAgentDto } from './dto/register.dto';
import { JoinQueueDto } from './dto/queue.dto';
import { SubmitMoveDto } from './dto/move.dto';

@Injectable()
export class AgentApiService {
  private readonly logger = new Logger(AgentApiService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    private readonly activeMatches: ActiveMatchesService,
    private readonly humanMoveService: HumanMoveService,
    private readonly matchmakingService: MatchmakingService,
    private readonly matchManager: MatchManagerService,
  ) {}

  async registerAgent(dto: RegisterAgentDto) {
    const rawKey = 'ak_' + randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.substring(0, 11); // "ak_" + 8 hex chars
    const claimToken = randomUUID();

    // Generate a dedicated wallet for this agent
    const privKey = generatePrivateKey();
    const account = privateKeyToAccount(privKey);

    const agent = await this.agentModel.create({
      userId: dto.userId ?? null as any,
      name: dto.name,
      type: 'pull',
      gameTypes: dto.gameTypes,
      walletAddress: dto.walletAddress ?? account.address,
      walletPrivateKey: privKey,
      apiKeyHash: hash,
      apiKeyPrefix: prefix,
      claimToken,
      claimStatus: 'unclaimed',
      status: 'idle',
      eloRating: 1200,
      stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0 },
    });

    this.logger.log(`Registered pull agent "${dto.name}" (id=${agent._id}, prefix=${prefix})`);

    return {
      agentId: agent._id.toString(),
      apiKey: rawKey,
      apiKeyPrefix: prefix,
      claimToken,
      claimUrl: `/v1/claims/${claimToken}`,
      name: dto.name,
      gameTypes: dto.gameTypes,
      walletAddress: agent.walletAddress,
    };
  }

  async getAgentStatus(agent: Agent) {
    const agentId = (agent as any)._id.toString();

    // Check if in an active match
    let activeMatchId: string | null = null;
    for (const [matchId, state] of this.activeMatches.entries()) {
      for (const side of Object.keys(state.agents)) {
        if (state.agents[side].agentId === agentId) {
          activeMatchId = matchId;
          break;
        }
      }
      if (activeMatchId) break;
    }

    // Check if in queue
    const queueEntry = await this.matchmakingService.getQueueStatus(agentId);

    return {
      agentId,
      name: agent.name,
      status: agent.status,
      eloRating: agent.eloRating,
      stats: agent.stats,
      gameTypes: agent.gameTypes,
      claimStatus: agent.claimStatus,
      xUsername: agent.xUsername,
      lastHeartbeat: agent.lastHeartbeat,
      activeMatchId,
      inQueue: !!queueEntry,
      queueGameType: queueEntry?.gameType,
    };
  }

  async joinQueue(agent: Agent, dto: JoinQueueDto) {
    const agentId = (agent as any)._id.toString();

    if (agent.status !== 'idle') {
      throw new BadRequestException(
        `Agent cannot join queue because its status is "${agent.status}". It must be "idle".`,
      );
    }

    if (!agent.gameTypes.includes(dto.gameType)) {
      throw new BadRequestException(`Agent does not support game type "${dto.gameType}".`);
    }

    agent.status = 'queued';
    await (agent as any).save();

    try {
      await this.matchmakingService.joinQueue(
        agentId,
        agent.userId?.toString() ?? agentId,
        agent.eloRating,
        dto.stakeAmount ?? 0,
        dto.gameType,
        'pull',
      );

      return {
        message: 'Successfully joined queue',
        agentId,
        gameType: dto.gameType,
        stakeAmount: dto.stakeAmount ?? 0,
      };
    } catch (err) {
      agent.status = 'idle';
      await (agent as any).save();
      throw err;
    }
  }

  async leaveQueue(agent: Agent) {
    const agentId = (agent as any)._id.toString();

    if (agent.status !== 'queued') {
      throw new BadRequestException(`Agent is not in the queue (current status: "${agent.status}")`);
    }

    await this.matchmakingService.leaveQueue(agentId);
    agent.status = 'idle';
    await (agent as any).save();

    return { message: 'Successfully left the queue', agentId };
  }

  async getGameState(agent: Agent, matchId: string) {
    const agentId = (agent as any)._id.toString();
    const matchState = this.activeMatches.getMatch(matchId);

    if (!matchState) {
      throw new NotFoundException('Match not found or not active');
    }

    // Verify agent is in this match
    let agentSide: string | null = null;
    for (const side of Object.keys(matchState.agents)) {
      if (matchState.agents[side].agentId === agentId) {
        agentSide = side;
        break;
      }
    }

    if (!agentSide) {
      throw new BadRequestException('Agent is not a participant in this match');
    }

    const gameType = this.matchManager.getGameType(matchId);
    const isYourTurn = this.humanMoveService.getPendingAgentId(matchId) === agentId;

    const baseState: Record<string, unknown> = {
      matchId,
      gameType,
      yourSide: agentSide,
      status: matchState.status,
      isYourTurn,
      timeRemainingMs: matchState.clock?.getTimeRemainingMs() ?? 0,
    };

    if (gameType === 'chess') {
      const chessEngine = this.matchManager.getChessEngine(matchId);
      const moveHistory = this.matchManager.getChessMoveHistory(matchId);
      if (chessEngine) {
        baseState.fen = chessEngine.getFen();
        baseState.board = chessEngine.getBoard();
        baseState.moveHistory = moveHistory ?? [];
        baseState.moveNumber = chessEngine.getMoveNumber();
        baseState.isCheck = chessEngine.isCheck();
        baseState.isGameOver = chessEngine.isGameOver();
        if (isYourTurn) {
          baseState.legalMoves = chessEngine.getLegalMovesUci();
          baseState.yourColor = chessEngine.getTurn();
        }
      }
    } else if (gameType === 'poker') {
      const pokerState = this.matchManager.getPokerState(matchId);
      if (pokerState) {
        baseState.handNumber = pokerState.handNumber;
        baseState.street = pokerState.street;
        baseState.pot = pokerState.pot;
        baseState.communityCards = pokerState.communityCards;
        baseState.yourStack = pokerState.players[agentSide as 'a' | 'b']?.stack;
        baseState.yourHoleCards = pokerState.players[agentSide as 'a' | 'b']?.holeCards;
        baseState.isDealer = pokerState.players[agentSide as 'a' | 'b']?.isDealer;
        baseState.actionHistory = pokerState.actionHistory;
        if (isYourTurn) {
          baseState.legalActions = getLegalActions(pokerState);
        }
      }
    } else {
      // Reversi/Marrakech — use generic game state
      baseState.board = matchState.gameState.board;
      baseState.scores = matchState.gameState.scores;
      baseState.moveNumber = matchState.gameState.moveNumber;
      baseState.isGameOver = matchState.gameState.gameOver;
      if (isYourTurn) {
        baseState.legalMoves = matchState.gameState.board; // Simplified — turn controller computes legal moves
      }
    }

    return baseState;
  }

  async submitMove(agent: Agent, matchId: string, dto: SubmitMoveDto) {
    const agentId = (agent as any)._id.toString();
    const matchState = this.activeMatches.getMatch(matchId);

    if (!matchState) {
      throw new NotFoundException('Match not found or not active');
    }

    // Verify agent is in this match
    let agentSide: string | null = null;
    for (const side of Object.keys(matchState.agents)) {
      if (matchState.agents[side].agentId === agentId) {
        agentSide = side;
        break;
      }
    }

    if (!agentSide) {
      throw new BadRequestException('Agent is not a participant in this match');
    }

    // Determine the move format based on game type
    const gameType = this.matchManager.getGameType(matchId);
    let move: unknown;

    if (gameType === 'chess') {
      // Support both "move" (UCI) and "from"+"to" formats
      if (dto.move) {
        move = dto.move;
      } else if (dto.from && dto.to) {
        move = dto.from + dto.to + (dto.promotion ?? '');
      } else {
        throw new BadRequestException('Chess move requires "move" (UCI format) or "from" + "to"');
      }
    } else if (gameType === 'poker') {
      if (!dto.action) {
        throw new BadRequestException('Poker move requires "action"');
      }
      move = { action: dto.action, amount: dto.amount };
    } else {
      // Reversi/Marrakech
      if (dto.row === undefined || dto.col === undefined) {
        throw new BadRequestException('Move requires "row" and "col"');
      }
      move = [dto.row, dto.col];
    }

    const submitted = this.humanMoveService.submitMove(matchId, agentId, move);
    if (!submitted) {
      throw new BadRequestException('Failed to submit move. It may not be your turn.');
    }

    return { success: true, matchId };
  }
}
