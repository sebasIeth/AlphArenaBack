import { IsString, MinLength, MaxLength, IsUrl, IsArray, ArrayMinSize, IsIn, IsOptional, ValidateIf } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @MinLength(1, { message: 'Agent name is required' })
  @MaxLength(50, { message: 'Agent name must be at most 50 characters' })
  name: string;

  @IsIn(['http', 'openclaw'], { message: 'Agent type must be "http" or "openclaw"' })
  @IsOptional()
  type?: string;

  @ValidateIf((o) => !o.type || o.type === 'http')
  @IsUrl({}, { message: 'Endpoint URL must be a valid URL' })
  endpointUrl?: string;

  @ValidateIf((o) => o.type === 'openclaw')
  @IsUrl({}, { message: 'OpenClaw URL must be a valid URL' })
  openclawUrl?: string;

  @ValidateIf((o) => o.type === 'openclaw')
  @IsString({ message: 'OpenClaw gateway token is required' })
  @MinLength(1, { message: 'OpenClaw gateway token is required' })
  openclawToken?: string;

  @IsOptional()
  @IsString()
  openclawAgentId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one game type is required' })
  @IsIn(['reversi', 'marrakech'], { each: true })
  gameTypes: string[];
}
