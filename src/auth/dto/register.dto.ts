import { IsString, MinLength, MaxLength, Matches, IsOptional, IsEmail } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters' })
  @MaxLength(30, { message: 'Username must be at most 30 characters' })
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username may only contain letters, numbers, and underscores' })
  username: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(128, { message: 'Password must be at most 128 characters' })
  password: string;

  @IsOptional()
  @IsEmail({}, { message: 'Invalid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  verificationCode?: string;
}
