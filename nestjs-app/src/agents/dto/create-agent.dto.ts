import { IsString, MinLength, MaxLength, IsUrl, IsArray, ArrayMinSize, IsIn } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @MinLength(1, { message: 'Agent name is required' })
  @MaxLength(50, { message: 'Agent name must be at most 50 characters' })
  name: string;

  @IsUrl({}, { message: 'Endpoint URL must be a valid URL' })
  endpointUrl: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'At least one game type is required' })
  @IsIn(['reversi', 'marrakech'], { each: true })
  gameTypes: string[];
}
