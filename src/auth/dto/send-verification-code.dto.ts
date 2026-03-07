import { IsEmail } from 'class-validator';

export class SendVerificationCodeDto {
  @IsEmail({}, { message: 'Invalid email address' })
  email: string;
}
