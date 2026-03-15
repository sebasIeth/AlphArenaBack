import { IsString, MinLength, MaxLength, IsArray, ArrayMinSize, IsIn, IsOptional } from 'class-validator';

export class RegisterAgentDto {
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

  @IsOptional()
  @IsString()
  userId?: string;
}
