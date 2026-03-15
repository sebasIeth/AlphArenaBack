import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';

export class SubmitMoveDto {
  // Chess: UCI move like "e2e4"
  @IsOptional()
  @IsString()
  move?: string;

  // Chess: from/to squares
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  promotion?: string;

  // Reversi/Marrakech: row/col
  @IsOptional()
  @IsNumber()
  row?: number;

  @IsOptional()
  @IsNumber()
  col?: number;

  // Poker: action
  @IsOptional()
  @IsIn(['fold', 'check', 'call', 'raise', 'all_in'])
  action?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;
}
