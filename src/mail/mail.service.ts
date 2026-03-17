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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Alph</span><span style="font-size:28px;font-weight:700;color:#a855f7;letter-spacing:-0.5px;">Arena</span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:linear-gradient(145deg,#13131a,#1a1a25);border:1px solid rgba(168,85,247,0.15);border-radius:16px;padding:40px 36px;">
          <!-- Icon -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">
            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(124,58,237,0.08));display:inline-flex;align-items:center;justify-content:center;line-height:64px;text-align:center;">
              <span style="font-size:28px;">&#9989;</span>
            </div>
          </td></tr></table>
          <!-- Title -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Verify Your Email</h1>
          </td></tr></table>
          <!-- Subtitle -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.5;">Use the code below to verify your email address.</p>
          </td></tr></table>
          <!-- User badge -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <div style="display:inline-block;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:8px;padding:10px 20px;">
              <span style="font-size:13px;color:#9ca3af;">Account: </span>
              <span style="font-size:13px;color:#c084fc;font-weight:600;">${username}</span>
            </div>
          </td></tr></table>
          <!-- Code -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <div style="display:inline-block;background:rgba(168,85,247,0.1);border:2px solid rgba(168,85,247,0.3);border-radius:12px;padding:16px 40px;">
              <span style="font-size:32px;font-weight:700;color:#ffffff;letter-spacing:8px;">${code}</span>
            </div>
          </td></tr></table>
          <!-- Expiry notice -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:20px;">
            <div style="display:inline-block;background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.15);border-radius:8px;padding:10px 16px;">
              <span style="font-size:12px;color:#d4a843;">&#9200; This code expires in 10 minutes</span>
            </div>
          </td></tr></table>
          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 0;">
            <div style="border-top:1px solid rgba(255,255,255,0.06);"></div>
          </td></tr></table>
        </td></tr>
        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0 0 6px 0;font-size:12px;color:#4b5563;">If you didn't request this, you can safely ignore this email.</p>
          <p style="margin:0;font-size:11px;color:#374151;">AlphArena &mdash; AI Agent Battle Arena</p>
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
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:32px;">
          <span style="font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Alph</span><span style="font-size:28px;font-weight:700;color:#a855f7;letter-spacing:-0.5px;">Arena</span>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:linear-gradient(145deg,#13131a,#1a1a25);border:1px solid rgba(168,85,247,0.15);border-radius:16px;padding:40px 36px;">
          <!-- Icon -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:24px;">
            <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,rgba(168,85,247,0.15),rgba(124,58,237,0.08));display:inline-flex;align-items:center;justify-content:center;line-height:64px;text-align:center;">
              <span style="font-size:28px;">&#128274;</span>
            </div>
          </td></tr></table>
          <!-- Title -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:8px;">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Password Reset</h1>
          </td></tr></table>
          <!-- Subtitle -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.5;">We received a request to reset the password for your account.</p>
          </td></tr></table>
          <!-- User badge -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <div style="display:inline-block;background:rgba(168,85,247,0.08);border:1px solid rgba(168,85,247,0.2);border-radius:8px;padding:10px 20px;">
              <span style="font-size:13px;color:#9ca3af;">Account: </span>
              <span style="font-size:13px;color:#c084fc;font-weight:600;">${username}</span>
            </div>
          </td></tr></table>
          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <a href="${resetUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#a855f7,#7c3aed);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 40px;border-radius:10px;letter-spacing:0.3px;box-shadow:0 4px 20px rgba(168,85,247,0.3);">
              Reset My Password
            </a>
          </td></tr></table>
          <!-- Expiry notice -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:20px;">
            <div style="display:inline-block;background:rgba(234,179,8,0.06);border:1px solid rgba(234,179,8,0.15);border-radius:8px;padding:10px 16px;">
              <span style="font-size:12px;color:#d4a843;">&#9200; This link expires in 1 hour</span>
            </div>
          </td></tr></table>
          <!-- Divider -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:8px 0;">
            <div style="border-top:1px solid rgba(255,255,255,0.06);"></div>
          </td></tr></table>
          <!-- Fallback link -->
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-top:16px;">
            <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">If the button doesn't work, copy and paste this link:</p>
            <p style="margin:0;font-size:11px;color:#7c3aed;word-break:break-all;line-height:1.5;">${resetUrl}</p>
          </td></tr></table>
        </td></tr>
        <!-- Footer -->
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0 0 6px 0;font-size:12px;color:#4b5563;">If you didn't request this, you can safely ignore this email.</p>
          <p style="margin:0;font-size:11px;color:#374151;">AlphArena &mdash; AI Agent Battle Arena</p>
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
        subject: 'AlphArena — Reset Your Password',
        html,
      });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${to}`, error);
      throw error;
    }
  }
}
