import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    if (
      process.env.NODE_ENV === 'production' &&
      !this.configService.get<string>('email.resendApiKey')
    ) {
      this.logger.warn(
        'RESEND_API_KEY is not configured. Password reset emails will not be sent. ' +
          'Set RESEND_API_KEY in the environment to enable email delivery.',
      );
    }
  }

  /**
   * Generic transactional send used by domain modules that build their own
   * localized subject + HTML (e.g. the ARCO data-subject notifications). Like
   * the password-reset send it never throws — a delivery failure is logged but
   * must not block the API response — and it no-ops when RESEND_API_KEY is
   * unset so non-production environments stay quiet.
   */
  async sendTransactionalEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const apiKey = this.configService.get<string>('email.resendApiKey');
    if (!apiKey) {
      this.logger.warn(
        JSON.stringify({
          event: 'email.transactional.skipped',
          reason: 'RESEND_API_KEY_NOT_CONFIGURED',
          subject,
        }),
      );
      return;
    }
    const from = this.configService.get<string>('email.from')!;
    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({ from, to, subject, html });
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'email.transactional.failed',
          reason: err instanceof Error ? err.message : 'UNKNOWN',
        }),
      );
      // Do not rethrow — email failure must not block the API response.
    }
  }

  async sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
    const apiKey = this.configService.get<string>('email.resendApiKey');

    if (!apiKey) {
      this.logger.warn(
        JSON.stringify({
          event: 'email.password_reset.skipped',
          reason: 'RESEND_API_KEY_NOT_CONFIGURED',
        }),
      );
      return;
    }

    const from = this.configService.get<string>('email.from')!;
    const appUrl = this.configService.get<string>('email.appUrl')!;
    const resetUrl = `${appUrl}/en/reset-password?token=${rawToken}`;

    try {
      const resend = new Resend(apiKey);
      await resend.emails.send({
        from,
        to,
        subject: 'Reset your LivoClouds password',
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1e293b; margin-bottom: 8px;">Reset your password</h2>
            <p style="color: #475569; margin-bottom: 24px;">
              Click the button below to set a new password for your LivoClouds account.
              This link expires in 30 minutes.
            </p>
            <a
              href="${resetUrl}"
              style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;
                     padding:12px 24px;border-radius:6px;font-weight:600;"
            >
              Reset password
            </a>
            <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
              If you did not request a password reset, you can safely ignore this email.
            </p>
          </div>
        `,
      });
    } catch (err) {
      this.logger.error(
        JSON.stringify({
          event: 'email.password_reset.failed',
          reason: err instanceof Error ? err.message : 'UNKNOWN',
        }),
      );
      // Do not rethrow — email failure must not block the API response.
    }
  }
}
