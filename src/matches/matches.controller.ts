import { Controller, Get, Param, Query, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { MatchesService } from './matches.service';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
  ) {
    return this.matchesService.findAll(status, limit, offset);
  }

  @Get('active')
  findActive() {
    return this.matchesService.findActive();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.matchesService.findById(id);
  }

  @Get(':id/moves')
  findMoves(@Param('id') id: string) {
    return this.matchesService.findMoves(id);
  }
}
