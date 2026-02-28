import { IsString, MinLength, MaxLength, IsUrl, IsArray, ArrayMinSize, IsIn, IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Agent name cannot be empty' })
  @MaxLength(50, { message: 'Agent name must be at most 50 characters' })
  name?: string;

  @IsOptional()
  @IsUrl({}, { message: 'Endpoint URL must be a valid URL' })
  endpointUrl?: string;

  @IsOptional()
  @IsUrl({}, { message: 'OpenClaw URL must be a valid URL' })
  openclawUrl?: string;

  @IsOptional()
  @IsString()
  openclawToken?: string;

  @IsOptional()
  @IsString()
  openclawAgentId?: string;
@IsOptional()
  @IsString()
  selfclawPublicKey?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one game type is required' })
  @IsIn(['marrakech', 'chess'], { each: true })
  gameTypes?: string[];

  @IsOptional()
  @IsBoolean()
  autoPlay?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  autoPlayStakeAmount?: number;
}
