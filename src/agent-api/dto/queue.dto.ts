import { IsString, MinLength, IsIn, IsOptional, IsNumber, Min } from 'class-validator';

export class JoinQueueDto {
  @IsOptional()
  @IsString()
  gameType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stakeAmount?: number;

  @IsOptional()
  @IsString()
  token?: string;
}

export class LeaveQueueDto {}
