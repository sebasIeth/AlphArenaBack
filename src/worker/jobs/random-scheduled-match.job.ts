import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agent, ScheduledMatch, Match } from '../../database/schemas';

const COLORS = ['#E84855', '#4361EE', '#06D6A0', '#F7B32B', '#8338EC', '#2EC4B6', '#FF6B6B', '#6B5B95', '#88B04B'];

/** Schedule matches 1–3 minutes in the future */
const SCHEDULE_MIN_MINUTES = 1;
const SCHEDULE_MAX_MINUTES = 3;

/** Max number of scheduled matches to keep pending at once */
const MAX_PENDING_SCHEDULED = 8;

/** Default stake for auto-generated matches */
const DEFAULT_STAKE = 0;

/** Only these game types get auto-scheduled */
const SCHEDULABLE_GAMES = ['chess', 'poker'];

@Injectable()
export class RandomScheduledMatchJob {
  private readonly logger = new Logger(RandomScheduledMatchJob.name);

  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<Agent>,
    @InjectModel(ScheduledMatch.name) private readonly scheduledMatchModel: Model<ScheduledMatch>,
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
  ) {}

  async run(): Promise<void> {
    // Auto-scheduling disabled — matches are created manually
    return;

    // Check how many are already pending
    const pendingCount = await this.scheduledMatchModel.countDocuments({
      status: { $in: ['scheduled', 'starting'] },
    });

    const slotsAvailable = MAX_PENDING_SCHEDULED - pendingCount;
    if (slotsAvailable <= 0) return;

    // Find idle, non-human agents that have a working endpoint
    const agents = await this.agentModel.find({
      status: 'idle',
      type: { $ne: 'human' },
      $or: [
        { endpointUrl: { $exists: true, $ne: '' } },
        { openclawUrl: { $exists: true, $ne: '' } },
      ],
    }).lean();

    if (agents.length < 2) return;

    // Group agents by game type
    const byGame: Record<string, typeof agents> = {};
    for (const agent of agents) {
      for (const gt of agent.gameTypes || []) {
        if (!SCHEDULABLE_GAMES.includes(gt)) continue;
        if (!byGame[gt]) byGame[gt] = [];
        byGame[gt].push(agent);
      }
    }

    const eligibleGames = Object.entries(byGame).filter(([, arr]) => arr.length >= 2);
    if (eligibleGames.length === 0) return;

    // Create as many matches as we have slots for
    let created = 0;
    for (let i = 0; i < slotsAvailable && i < 3; i++) {
      const [gameType, pool] = eligibleGames[Math.floor(Math.random() * eligibleGames.length)];

      // Shuffle and pick 2 random agents
      const shuffled = pool.sort(() => Math.random() - 0.5);
      const picked = shuffled.slice(0, 2);

      // Don't match agents from the same user
      if (picked[0].userId.toString() === picked[1].userId.toString()) {
        const alt = shuffled.find(
          (a) =>
            a._id.toString() !== picked[0]._id.toString() &&
            a.userId.toString() !== picked[0].userId.toString(),
        );
        if (!alt) continue;
        picked[1] = alt!;
      }

      // Check this exact pair doesn't already have a pending scheduled match
      const existingPair = await this.scheduledMatchModel.findOne({
        status: { $in: ['scheduled', 'starting'] },
        'agents.agentId': { $all: [picked[0]._id, picked[1]._id] },
      });
      if (existingPair) continue;

      // Skip agents that already have active or starting matches
      const activeMatch = await this.matchModel.findOne({
        status: { $in: ['active', 'starting'] },
        $or: [
          { 'agents.a.agentId': { $in: [picked[0]._id.toString(), picked[1]._id.toString()] } },
          { 'agents.b.agentId': { $in: [picked[0]._id.toString(), picked[1]._id.toString()] } },
        ],
      });
      if (activeMatch) continue;

      // Stagger: first match sooner, later ones a bit further out
      const baseMinutes = SCHEDULE_MIN_MINUTES + i;
      const randomMinutes = baseMinutes + Math.floor(Math.random() * (SCHEDULE_MAX_MINUTES - SCHEDULE_MIN_MINUTES + 1));
      const scheduledAt = new Date(Date.now() + randomMinutes * 60 * 1000);

      const scheduledAgents = picked.map((agent, idx) => ({
        agentId: agent._id,
        userId: agent.userId,
        name: agent.name,
        elo: agent.eloRating,
        color: COLORS[idx % COLORS.length],
      }));

      const stake = DEFAULT_STAKE;

      // Create placeholder Match so betting opens immediately
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
        status: 'starting',
      });

      await this.scheduledMatchModel.create({
        gameType,
        scheduledAt,
        stakeAmount: stake,
        agents: scheduledAgents,
        matchId: matchDoc._id.toString(),
        createdBy: new Types.ObjectId(picked[0].userId),
      });

      created++;
      this.logger.log(
        `Auto-scheduled ${gameType} match: "${picked[0].name}" vs "${picked[1].name}" → match ${matchDoc._id} at ${scheduledAt.toISOString()}`,
      );
    }

    if (created > 0) {
      this.logger.log(`Created ${created} new scheduled match(es)`);
    }
  }
}
