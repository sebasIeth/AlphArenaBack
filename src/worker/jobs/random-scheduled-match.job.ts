import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agent, ScheduledMatch, Match } from '../../database/schemas';

const COLORS = ['#E84855', '#4361EE', '#06D6A0', '#F7B32B', '#8338EC', '#2EC4B6', '#FF6B6B', '#6B5B95', '#88B04B'];

/** Default stake for auto-generated matches */
const DEFAULT_STAKE = 0;

/** Only these game types get auto-scheduled */
const SCHEDULABLE_GAMES = ['chess', 'poker'];

/** Only these agents are eligible for auto-scheduling */
const ALLOWED_AGENT_NAMES = ['TobiasdevBot', 'ApoloBot'];

@Injectable()
export class RandomScheduledMatchJob {
  private readonly logger = new Logger(RandomScheduledMatchJob.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(ScheduledMatch.name) private readonly scheduledMatchModel: Model<ScheduledMatch>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
  ) {}

  async run(): Promise<void> {
    // Find only the allowed agents that are idle
    const agents = await this.agentModel.find({
      status: 'idle',
      type: { $ne: 'human' },
      name: { $in: ALLOWED_AGENT_NAMES },
    }).lean();

    // Deduplicate by name (keep first occurrence)
    const seen = new Set<string>();
    const uniqueAgents = agents.filter((a) => {
      if (seen.has(a.name)) return false;
      seen.add(a.name);
      return true;
    });

    // Need exactly 2 distinct agents
    if (uniqueAgents.length < 2) return;

    const picked = uniqueAgents.slice(0, 2);

    // Check if either agent name is already in an active/starting/pending match
    const pickedNames = picked.map((a) => a.name);
    const activeMatch = await this.matchModel.findOne({
      status: { $in: ['active', 'starting', 'pending'] },
      $or: [
        { 'agents.a.name': { $in: pickedNames } },
        { 'agents.b.name': { $in: pickedNames } },
      ],
    });
    if (activeMatch) {
      this.logger.debug(`Skipping: agent already in match ${activeMatch._id} (status: ${activeMatch.status})`);
      return;
    }

    // Check if there's already a pending scheduled match for this pair
    const existingScheduled = await this.scheduledMatchModel.findOne({
      status: { $in: ['scheduled', 'starting'] },
    });
    if (existingScheduled) {
      this.logger.debug(`Skipping: scheduled match ${existingScheduled._id} already pending`);
      return;
    }

    // Pick a random game type both agents support
    const commonGames = SCHEDULABLE_GAMES.filter((gt) =>
      picked.every((a) => (a.gameTypes || []).includes(gt)),
    );
    if (commonGames.length === 0) return;

    const gameType = commonGames[Math.floor(Math.random() * commonGames.length)];

    // Schedule 10s in the future
    const scheduledAt = new Date(Date.now() + 10 * 1000);

    const scheduledAgents = picked.map((agent, idx) => ({
      agentId: agent._id,
      userId: agent.userId ?? undefined,
      name: agent.name,
      elo: agent.eloRating,
      color: COLORS[idx % COLORS.length],
    }));

    const stake = DEFAULT_STAKE;

    // Create placeholder Match
    const matchDoc = await this.matchModel.create({
      gameType,
      agents: {
        a: {
          agentId: picked[0]._id,
          userId: picked[0].userId,
          name: picked[0].name,
          eloAtStart: picked[0].eloRating,
        },
        b: {
          agentId: picked[1]._id,
          userId: picked[1].userId,
          name: picked[1].name,
          eloAtStart: picked[1].eloRating,
        },
      },
      stakeAmount: stake,
      potAmount: stake * 2,
      status: 'pending',
    });

    await this.scheduledMatchModel.create({
      gameType,
      scheduledAt,
      stakeAmount: stake,
      agents: scheduledAgents,
      matchId: matchDoc._id.toString(),
      createdBy: picked[0].userId ? new Types.ObjectId(picked[0].userId) : undefined,
    });

    this.logger.log(
      `Auto-scheduled ${gameType}: "${picked[0].name}" vs "${picked[1].name}" → match ${matchDoc._id} at ${scheduledAt.toISOString()}`,
    );
  }
}
