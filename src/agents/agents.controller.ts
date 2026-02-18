import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreateAgentDto) {
    return this.agentsService.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthPayload) {
    return this.agentsService.findAllByUser(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.findById(id, user.userId);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthPayload, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(id, user.userId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.remove(id, user.userId);
  }
}
