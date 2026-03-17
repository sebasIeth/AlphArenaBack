import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyCodeDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @Length(6, 6, { message: 'Verification code must be 6 digits' })
  code: string;
}
