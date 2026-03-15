import { IsArray, ArrayMaxSize, ValidateNested, IsString, MinLength, MaxLength, ArrayMinSize, IsIn, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BatchRegisterEntry {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['chess', 'poker', 'marrakech', 'reversi'], { each: true })
  gameTypes: string[];

  @IsOptional()
  @IsString()
  walletAddress?: string;
}

export class BatchRegisterDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ValidateNested({ each: true })
  @Type(() => BatchRegisterEntry)
  agents: BatchRegisterEntry[];
}

export class BatchHeartbeatEntry {
  @IsString()
  @MinLength(1)
  apiKey: string;
}

export class BatchHeartbeatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchHeartbeatEntry)
  agents: BatchHeartbeatEntry[];
}

export class BatchMoveEntry {
  @IsString()
  @MinLength(1)
  apiKey: string;

  @IsString()
  @MinLength(1)
  matchId: string;

  // Chess
  @IsOptional()
  @IsString()
  move?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  promotion?: string;

  // Reversi/Marrakech
  @IsOptional()
  @IsNumber()
  row?: number;

  @IsOptional()
  @IsNumber()
  col?: number;

  // Poker
  @IsOptional()
  @IsIn(['fold', 'check', 'call', 'raise', 'all_in'])
  action?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;
}

export class BatchMoveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => BatchMoveEntry)
  moves: BatchMoveEntry[];
}
