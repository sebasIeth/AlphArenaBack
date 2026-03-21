import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '../common/config/config.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.smtpHost,
      port: this.configService.smtpPort,
      secure: this.configService.smtpPort === 465,
      auth: {
        user: this.configService.smtpUser,
        pass: this.configService.smtpPass,
      },
    });
  }

  async sendVerificationCodeEmail(to: string, username: string, code: string): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#F5F0EB;font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F0EB;background-image:linear-gradient(rgba(0,0,0,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.03) 1px,transparent 1px);background-size:40px 40px;padding:48px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;font-family:'Playfair Display',Georgia,serif;">Alph</span><span style="font-size:28px;font-weight:700;color:#5B4FCF;letter-spacing:-0.5px;font-family:'Playfair Display',Georgia,serif;">Arena</span>
        </td></tr>

        <!-- Top accent bar -->
        <tr><td style="padding:0;">
          <div style="height:4px;border-radius:20px 20px 0 0;background:linear-gradient(90deg,#4A3FB5,#5B4FCF,#7B6FE0,#E8A500);"></div>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#FFFFFF;border:1px solid #D4D0C8;border-top:none;border-radius:0 0 16px 16px;padding:44px 40px;box-shadow:0 10px 25px -3px rgba(0,0,0,0.08),0 4px 6px -4px rgba(0,0,0,0.03);">

          <!-- Icon -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">
            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,rgba(91,79,207,0.12),rgba(91,79,207,0.04));border:1px solid rgba(91,79,207,0.15);display:inline-block;text-align:center;line-height:64px;">
              <span style="font-size:28px;">&#9993;</span>
            </div>
          </td></tr></table>

          <!-- Welcome badge -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;">
            <div style="display:inline-block;background:linear-gradient(135deg,rgba(91,79,207,0.08),rgba(123,111,224,0.05));border-radius:20px;padding:4px 14px;">
              <span style="font-size:11px;font-weight:600;color:#5B4FCF;text-transform:uppercase;letter-spacing:1.5px;">Welcome to AlphArena</span>
            </div>
          </td></tr></table>

          <!-- Title -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;">
            <h1 style="margin:0;font-size:26px;font-weight:700;color:#1A1A1A;letter-spacing:-0.3px;font-family:'Playfair Display',Georgia,serif;">Verify Your Email</h1>
          </td></tr></table>

          <!-- Subtitle -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.6;">Enter the verification code below to confirm your email address and start competing.</p>
          </td></tr></table>

          <!-- User badge -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <div style="display:inline-block;background:#F9F6F2;border:1px solid #D4D0C8;border-radius:10px;padding:12px 24px;">
              <span style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.8px;font-weight:500;">Account</span><br/>
              <span style="font-size:15px;color:#5B4FCF;font-weight:600;letter-spacing:0.2px;">${username}</span>
            </div>
          </td></tr></table>

          <!-- Code label -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:10px;">
            <span style="font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;">Your Verification Code</span>
          </td></tr></table>

          <!-- Code box -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <div style="display:inline-block;background:linear-gradient(145deg,#F9F6F2,#FFFFFF);border:2px solid #5B4FCF;border-radius:14px;padding:20px 48px;box-shadow:0 4px 16px rgba(91,79,207,0.1);">
              <span style="font-size:36px;font-weight:700;color:#1A1A1A;letter-spacing:12px;font-family:'JetBrains Mono','Courier New',monospace;">${code}</span>
            </div>
          </td></tr></table>

          <!-- Expiry notice -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">
            <div style="display:inline-block;background:rgba(232,165,0,0.08);border:1px solid rgba(232,165,0,0.2);border-radius:8px;padding:8px 16px;">
              <span style="font-size:12px;color:#B8860B;font-weight:500;">&#9200; This code expires in 10 minutes</span>
            </div>
          </td></tr></table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:4px 0 20px 0;">
            <div style="border-top:1px solid #EDE8E1;"></div>
          </td></tr></table>

          <!-- Instructions -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td>
            <div style="background:#F9F6F2;border:1px solid #EDE8E1;border-radius:10px;padding:16px 20px;">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">&#9889; How to verify</p>
              <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.6;">Go back to the sign-up page and enter the code above. Do not share this code with anyone.</p>
            </div>
          </td></tr></table>

        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0 0 6px 0;font-size:12px;color:#9CA3AF;">If you didn't create an account, you can safely ignore this email.</p>
          <p style="margin:0;font-size:11px;color:#9CA3AF;font-style:italic;">Where AI agents compete and evolve</p>
          <div style="margin-top:12px;height:3px;width:40px;border-radius:2px;background:linear-gradient(90deg,#5B4FCF,#E8A500);display:inline-block;"></div>
          <p style="margin:8px 0 0 0;font-size:10px;color:#D4D0C8;">AlphArena &copy; 2026</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.smtpFrom,
        to,
        subject: 'AlphArena — Your Verification Code',
        html,
      });
      this.logger.log(`Verification code email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send verification code email to ${to}`, error);
      throw error;
    }
  }

  async sendPasswordResetEmail(to: string, username: string, rawToken: string): Promise<void> {
    const resetUrl = `${this.configService.frontendUrl}/reset-password?token=${rawToken}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#F5F0EB;font-family:'DM Sans','Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F0EB;background-image:linear-gradient(rgba(0,0,0,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,0.03) 1px,transparent 1px);background-size:40px 40px;padding:48px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:700;color:#1A1A1A;letter-spacing:-0.5px;font-family:'Playfair Display',Georgia,serif;">Alph</span><span style="font-size:28px;font-weight:700;color:#5B4FCF;letter-spacing:-0.5px;font-family:'Playfair Display',Georgia,serif;">Arena</span>
        </td></tr>

        <!-- Top accent bar -->
        <tr><td style="padding:0;">
          <div style="height:4px;border-radius:20px 20px 0 0;background:linear-gradient(90deg,#4A3FB5,#5B4FCF,#7B6FE0,#E8A500);"></div>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#FFFFFF;border:1px solid #D4D0C8;border-top:none;border-radius:0 0 16px 16px;padding:44px 40px;box-shadow:0 10px 25px -3px rgba(0,0,0,0.08),0 4px 6px -4px rgba(0,0,0,0.03);">

          <!-- Icon -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">
            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,rgba(91,79,207,0.12),rgba(91,79,207,0.04));border:1px solid rgba(91,79,207,0.15);display:inline-block;text-align:center;line-height:64px;">
              <span style="font-size:28px;">&#128272;</span>
            </div>
          </td></tr></table>

          <!-- Title -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;">
            <h1 style="margin:0;font-size:26px;font-weight:700;color:#1A1A1A;letter-spacing:-0.3px;font-family:'Playfair Display',Georgia,serif;">Reset Your Password</h1>
          </td></tr></table>

          <!-- Subtitle -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.6;">We received a request to reset the password for your account. Click the button below to choose a new password.</p>
          </td></tr></table>

          <!-- User badge -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <div style="display:inline-block;background:#F9F6F2;border:1px solid #D4D0C8;border-radius:10px;padding:12px 24px;">
              <span style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.8px;font-weight:500;">Account</span><br/>
              <span style="font-size:15px;color:#5B4FCF;font-weight:600;letter-spacing:0.2px;">${username}</span>
            </div>
          </td></tr></table>

          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${resetUrl}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="20%" fillcolor="#5B4FCF">
              <center style="color:#ffffff;font-family:'DM Sans','Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600;">Reset My Password</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${resetUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#4A3FB5 0%,#5B4FCF 50%,#7B6FE0 100%);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:15px 48px;border-radius:12px;letter-spacing:0.3px;box-shadow:0 4px 16px rgba(91,79,207,0.3),0 1px 3px rgba(0,0,0,0.1);mso-hide:all;">
              Reset My Password
            </a>
            <!--<![endif]-->
          </td></tr></table>

          <!-- Expiry notice -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">
            <div style="display:inline-block;background:rgba(232,165,0,0.08);border:1px solid rgba(232,165,0,0.2);border-radius:8px;padding:8px 16px;">
              <span style="font-size:12px;color:#B8860B;font-weight:500;">&#9200; This link expires in 1 hour</span>
            </div>
          </td></tr></table>

          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:4px 0 20px 0;">
            <div style="border-top:1px solid #EDE8E1;"></div>
          </td></tr></table>

          <!-- Security tip -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:20px;">
            <div style="background:#F9F6F2;border:1px solid #EDE8E1;border-radius:10px;padding:16px 20px;">
              <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">&#128737; Security Tip</p>
              <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.6;">Never share this link with anyone. AlphArena will never ask you for your password via email.</p>
            </div>
          </td></tr></table>

          <!-- Fallback link -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td>
            <p style="margin:0 0 6px 0;font-size:11px;color:#9CA3AF;">If the button doesn't work, copy and paste this link:</p>
            <p style="margin:0;font-size:11px;color:#5B4FCF;word-break:break-all;line-height:1.5;background:#F9F6F2;border:1px solid #EDE8E1;border-radius:8px;padding:10px 14px;">${resetUrl}</p>
          </td></tr></table>

        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0 0 6px 0;font-size:12px;color:#9CA3AF;">If you didn't request this, you can safely ignore this email.</p>
          <p style="margin:0 0 4px 0;font-size:11px;color:#9CA3AF;">Your password won't change until you create a new one.</p>
          <p style="margin:0;font-size:11px;color:#9CA3AF;font-style:italic;">Where AI agents compete and evolve</p>
          <div style="margin-top:12px;height:3px;width:40px;border-radius:2px;background:linear-gradient(90deg,#5B4FCF,#E8A500);display:inline-block;"></div>
          <p style="margin:8px 0 0 0;font-size:10px;color:#D4D0C8;">AlphArena &copy; 2026</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
    `;

    try {
      await this.transporter.sendMail({
        from: this.configService.smtpFrom,
        to,
        subject: 'AlphArena \u2014 Reset Your Password',
        html,
      });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${to}`, error);
      throw error;
    }
  }
}
