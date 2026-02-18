import { Controller, Get, Param, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('agents')
  getAgentLeaderboard(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('gameType') gameType?: string,
  ) {
    return this.leaderboardService.getAgentLeaderboard(limit, gameType);
  }

  @Get('users')
  getUserLeaderboard(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number) {
    return this.leaderboardService.getUserLeaderboard(limit);
  }

  @Get('agents/:id/stats')
  getAgentStats(@Param('id') id: string) {
    return this.leaderboardService.getAgentStats(id);
  }
}
