import { Controller, Post, Get, Put, Delete, Body, Param, UseGuards, HttpCode } from '@nestjs/common';
import { IsString, MinLength, IsUrl, IsOptional } from 'class-validator';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthPayload } from '../common/types';

class TestConnectionDto {
  @IsUrl({}, { message: 'OpenClaw URL must be a valid URL' })
  openclawUrl: string;

  @IsString()
  @MinLength(1)
  openclawToken: string;

  @IsOptional()
  @IsString()
  openclawAgentId?: string;
}

class TestWebhookDto {
  @IsUrl({}, { message: 'OpenClaw URL must be a valid URL' })
  openclawUrl: string;

  @IsString()
  @MinLength(1)
  hookToken: string;
}

@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('test-connection')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.agentsService.testOpenClawConnection(
      dto.openclawUrl,
      dto.openclawToken,
      dto.openclawAgentId || 'main',
    );
  }

  @Post('test-webhook')
  testWebhook(@Body() dto: TestWebhookDto) {
    return this.agentsService.testOpenClawWebhook(
      dto.openclawUrl,
      dto.hookToken,
    );
  }

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

  @Get(':id/health')
  healthCheck(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.agentsService.healthCheck(id, user.userId);
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
