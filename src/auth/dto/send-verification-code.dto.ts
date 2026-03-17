import { IsEmail } from 'class-validator';

export class SendVerificationCodeDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}
