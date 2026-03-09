import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Agent, User, Match } from '../database/schemas';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { SettlementService } from '../settlement/settlement.service';
import { HumanMoveService } from '../orchestrator/human-move.service';
import { DEFAULT_ELO } from '../common/constants/game.constants';

@Injectable()
export class PlayService {
  private readonly logger = new Logger(PlayService.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    private readonly matchmakingService: MatchmakingService,
    private readonly settlement: SettlementService,
    private readonly humanMoveService: HumanMoveService,
  ) {}

  async joinQueue(userId: string, gameType: string, stakeAmount: number, chain: string = 'base') {
    const agent = await this.getOrCreateHumanAgent(userId, gameType, chain);

    // If already queued, check if actually in the matchmaking queue
    if (agent.status === 'queued') {
      const inQueue = await this.matchmakingService.getQueueStatus(agent._id.toString());
      if (inQueue) {
        // Already queued — return success
        return {
          message: 'Already in the matchmaking queue',
          agentId: agent._id.toString(),
          gameType,
          stakeAmount: inQueue.stakeAmount,
        };
      }
      // Stale status from server restart — reset
      this.logger.log(`Recovering stale queued status for human agent ${agent._id}`);
      agent.status = 'idle';
      await agent.save();
    }

    // Recover stale in_match status (match already ended but agent wasn't reset)
    if (agent.status === 'in_match') {
      const agentIdStr = agent._id.toString();
      const activeMatch = await this.matchModel.findOne({
        $or: [
          { 'agents.a.agentId': agentIdStr },
          { 'agents.b.agentId': agentIdStr },
          { 'pokerPlayers.agentId': agentIdStr },
        ],
        status: { $in: ['starting', 'active'] },
      }).select('_id').lean();

      if (!activeMatch) {
        this.logger.log(`Recovering stale in_match status for agent ${agentIdStr}`);
        agent.status = 'idle';
        await agent.save();
      }
    }

    if (agent.status !== 'idle') {
      throw new BadRequestException(`Your player agent is currently "${agent.status}". It must be "idle" to join the queue.`);
    }

    if (!agent.walletAddress) {
      throw new BadRequestException('Wallet not found. Please contact support.');
    }

    // Verify wallet balance on the agent's chain
    const agentChain = (agent.chain || 'base') as any;
    const [alphaBalance, ethBalance] = await Promise.all([
      this.settlement.getAgentAlphaBalance(agent.walletAddress, agentChain),
      this.settlement.getAgentEthBalance(agent.walletAddress, agentChain),
    ]);

    if (parseFloat(alphaBalance) < stakeAmount) {
      throw new BadRequestException(
        `Insufficient ALPHA balance. You have ${alphaBalance} ALPHA but need ${stakeAmount}. Deposit ALPHA to ${agent.walletAddress}`,
      );
    }

    if (parseFloat(ethBalance) < 0.0001) {
      throw new BadRequestException(
        `Insufficient ETH for gas. You have ${ethBalance} ETH but need at least 0.0001. Deposit ETH to ${agent.walletAddress}`,
      );
    }

    agent.status = 'queued';
    await agent.save();

    try {
      await this.matchmakingService.joinQueue(agent._id.toString(), userId, agent.eloRating, stakeAmount, gameType, 'human', agentChain);
      return {
        message: 'Successfully joined the matchmaking queue',
        agentId: agent._id.toString(),
        gameType,
        stakeAmount,
      };
    } catch (err) {
      agent.status = 'idle';
      await agent.save();
      throw err;
    }
  }

  async cancelQueue(userId: string) {
    const agent = await this.agentModel.findOne({
      userId,
      type: 'human',
      status: 'queued',
    });

    if (!agent) {
      throw new BadRequestException('You are not currently in the queue.');
    }

    await this.matchmakingService.leaveQueue(agent._id.toString());
    agent.status = 'idle';
    await agent.save();

    return { message: 'Successfully left the matchmaking queue' };
  }

  async getStatus(userId: string) {
    // Check for any human agent in queue or in match
    const agents = await this.agentModel.find({
      userId,
      type: 'human',
      status: { $in: ['queued', 'in_match'] },
    });

    if (agents.length === 0) {
      return { inQueue: false, inMatch: false };
    }

    for (const agent of agents) {
      if (agent.status === 'queued') {
        const queueEntry = await this.matchmakingService.getQueueStatus(agent._id.toString());
        return {
          inQueue: true,
          inMatch: false,
          agentId: agent._id.toString(),
          gameType: queueEntry?.gameType,
          stakeAmount: queueEntry?.stakeAmount,
        };
      }

      if (agent.status === 'in_match') {
        const agentIdStr = agent._id.toString();
        const activeMatch = await this.matchModel.findOne({
          $or: [
            { 'agents.a.agentId': agentIdStr },
            { 'agents.b.agentId': agentIdStr },
            { 'pokerPlayers.agentId': agentIdStr },
          ],
          status: { $in: ['starting', 'active'] },
        }).select('_id gameType status').lean();

        if (activeMatch) {
          return {
            inQueue: false,
            inMatch: true,
            agentId: agentIdStr,
            matchId: (activeMatch as any)._id.toString(),
            gameType: activeMatch.gameType,
            matchStatus: activeMatch.status,
          };
        }
      }
    }

    return { inQueue: false, inMatch: false };
  }

  async getBalance(userId: string, chain: string = 'base') {
    const user = await this.userModel.findById(userId);
    if (!user || !user.walletAddress) {
      throw new NotFoundException('User wallet not found');
    }

    const chainAvailable = this.settlement.getConfiguredChains().includes(chain as any);

    if (!chainAvailable) {
      return {
        walletAddress: user.walletAddress,
        alpha: '0',
        eth: '0',
        chain,
        gasToken: chain === 'celo' ? 'CELO' : 'ETH',
        chainAvailable: false,
      };
    }

    const [alpha, eth] = await Promise.all([
      this.settlement.getAgentAlphaBalance(user.walletAddress, chain as any),
      this.settlement.getAgentEthBalance(user.walletAddress, chain as any),
    ]);

    return {
      walletAddress: user.walletAddress,
      alpha,
      eth,
      chain,
      gasToken: chain === 'celo' ? 'CELO' : 'ETH',
      chainAvailable: true,
    };
  }

  async submitMove(userId: string, matchId: string, move: unknown) {
    // Find the user's human agent involved in this match
    const pendingAgentId = this.humanMoveService.getPendingAgentId(matchId);
    if (!pendingAgentId) {
      throw new BadRequestException('No pending move for this match.');
    }

    const agent = await this.agentModel.findById(pendingAgentId);
    if (!agent || agent.userId.toString() !== userId || agent.type !== 'human') {
      throw new BadRequestException('You are not the human player in this match.');
    }

    const submitted = this.humanMoveService.submitMove(matchId, pendingAgentId, move);
    if (!submitted) {
      throw new BadRequestException('Failed to submit move. It may no longer be your turn.');
    }

    return { success: true };
  }

  async getPokerLobbyStatus() {
    const lobby = this.matchmakingService.getPokerLobby();
    const countdownMs = this.matchmakingService.getPokerLobbyCountdownRemainingMs();
    return {
      playerCount: lobby.players.length,
      players: lobby.players.map(p => ({
        agentId: p.agentId,
        name: p.name,
        eloRating: p.eloRating,
      })),
      countdownMs: countdownMs >= 0 ? countdownMs : null,
      stakeAmount: lobby.stakeAmount,
    };
  }

  async getOrCreateHumanAgent(userId: string, gameType: string, chain: string = 'base'): Promise<Agent> {
    // Find an existing human agent for this user that supports this game type and chain
    let agent = await this.agentModel.findOne({
      userId,
      type: 'human',
      gameTypes: gameType,
      chain,
      status: { $ne: 'disabled' },
    });

    if (agent) return agent;

    // Create a new human agent
    const user = await this.userModel.findById(userId).select('+walletPrivateKey');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.walletAddress) {
      throw new BadRequestException('User does not have a wallet.');
    }

    agent = await this.agentModel.create({
      userId,
      name: user.username,
      type: 'human',
      chain,
      gameTypes: [gameType],
      eloRating: DEFAULT_ELO,
      status: 'idle',
      stats: { wins: 0, losses: 0, draws: 0, totalMatches: 0, winRate: 0, totalEarnings: 0 },
      walletAddress: user.walletAddress,
      walletPrivateKey: user.walletPrivateKey,
    });

    this.logger.log(`Created human agent "${user.username}" for user ${userId} (gameType=${gameType}, chain=${chain})`);
    return agent;
  }
}
