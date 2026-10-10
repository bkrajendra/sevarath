import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper over Resend's HTTP API (https://resend.com) - no SDK dependency, just `fetch`
 * (global since Node 18). Deliberately optional: with no RESEND_API_KEY configured, every send
 * call below is a no-op that returns `false` rather than throwing, so email delivery degrades
 * gracefully to "the admin console shows the credentials instead" (docs/open-items.md) rather
 * than blocking driver provisioning on a third-party integration nobody has set up yet.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return !!this.config.get<string>('RESEND_API_KEY');
  }

  /**
   * Sends a new driver their login credentials. Returns whether the email was actually sent -
   * callers must not treat `false` as an error to surface, since the admin console always shows
   * the same credentials as a fallback (this is a convenience channel, not the only one).
   */
  async sendDriverCredentials(params: {
    to: string;
    name: string;
    mobile: string;
    driverCode: string;
    temporaryPassword: string;
  }): Promise<boolean> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) return false;

    const from = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'SevaRath <onboarding@resend.dev>';

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: params.to,
          subject: 'Your SevaRath driver account',
          html: `<p>Hi ${params.name},</p>
<p>An administrator has set up a SevaRath driver account for you (driver code <strong>${params.driverCode}</strong>).</p>
<p>Sign in to the SevaRath driver app with:</p>
<ul>
  <li><strong>Mobile:</strong> ${params.mobile}</li>
  <li><strong>Password:</strong> ${params.temporaryPassword}</li>
</ul>
<p>Keep this password safe - contact your administrator if you ever need it reset.</p>`,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(
          `Resend API returned ${response.status} sending driver credentials to ${params.to}: ${body}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to send driver credentials email to ${params.to}: ${message}`);
      return false;
    }
  }
}
