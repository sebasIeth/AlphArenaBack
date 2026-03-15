import { IsString, MinLength, IsIn, IsOptional, IsNumber, Min } from 'class-validator';

export class JoinQueueDto {
  @IsIn(['chess', 'poker', 'marrakech', 'reversi'])
  gameType: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stakeAmount?: number;
}

export class LeaveQueueDto {}
