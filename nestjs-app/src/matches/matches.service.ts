import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Match, MoveDoc } from '../database/schemas';

@Injectable()
export class MatchesService {
  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<Match>,
    @InjectModel(MoveDoc.name) private readonly moveModel: Model<MoveDoc>,
  ) {}

  async findAll(status?: string, limit = 20, offset = 0) {
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const [matches, total] = await Promise.all([
      this.matchModel.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      this.matchModel.countDocuments(filter),
    ]);

    return {
      matches,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    };
  }

  async findActive() {
    const matches = await this.matchModel
      .find({ status: { $in: ['active', 'starting'] } })
      .sort({ createdAt: -1 })
      .lean();
    return { matches, count: matches.length };
  }

  async findById(id: string) {
    const match = await this.matchModel.findById(id).lean();
    if (!match) throw new NotFoundException('Match not found');
    return { match };
  }

  async findMoves(matchId: string) {
    const match = await this.matchModel.findById(matchId).lean();
    if (!match) throw new NotFoundException('Match not found');

    const moves = await this.moveModel.find({ matchId }).sort({ moveNumber: 1 }).lean();
    return { matchId, moves, totalMoves: moves.length };
  }
}
