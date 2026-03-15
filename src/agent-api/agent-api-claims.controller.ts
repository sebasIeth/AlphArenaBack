import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString, IsUrl } from 'class-validator';
import { ClaimService } from './claim.service';

class SubmitXVerificationDto {
  @IsString()
  tweetUrl: string;
}

@Controller('v1/claims')
@SkipThrottle()
export class AgentApiClaimsController {
  constructor(private readonly claimService: ClaimService) {}

  @Get(':claimToken')
  async getClaimStatus(@Param('claimToken') claimToken: string) {
    return this.claimService.getClaimStatus(claimToken);
  }

  @Post(':claimToken/x/verification/challenge')
  async generateChallenge(@Param('claimToken') claimToken: string) {
    return this.claimService.generateXChallenge(claimToken);
  }

  @Post(':claimToken/x/verification/submit')
  async submitVerification(
    @Param('claimToken') claimToken: string,
    @Body() dto: SubmitXVerificationDto,
  ) {
    return this.claimService.submitXVerification(claimToken, dto.tweetUrl);
  }
}
