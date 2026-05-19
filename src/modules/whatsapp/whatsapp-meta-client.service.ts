import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface MetaSendTextResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

export interface PhoneValidationResult {
  isWhatsAppBusiness: boolean;
  hasMessagesPermission: boolean;
  currentStatus: string;
}

@Injectable()
export class WhatsAppMetaClientService {
  private readonly logger = new Logger(WhatsAppMetaClientService.name);
  private readonly graphApiVersion: string;

  constructor(private configService: ConfigService) {
    this.graphApiVersion = configService.get<string>('whatsapp.graphApiVersion', 'v20.0');
  }

  async sendTextMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    text: string,
  ): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text },
    };

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as MetaSendTextResponse;
    return { messageId: data.messages?.[0]?.id ?? '' };
  }

  async validatePhoneNumber(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<PhoneValidationResult> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,status`;

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        return { isWhatsAppBusiness: false, hasMessagesPermission: false, currentStatus: 'ERROR' };
      }

      const data = (await response.json()) as { status?: string };
      return {
        isWhatsAppBusiness: true,
        hasMessagesPermission: true,
        currentStatus: data.status ?? 'UNKNOWN',
      };
    } catch {
      return { isWhatsAppBusiness: false, hasMessagesPermission: false, currentStatus: 'ERROR' };
    }
  }

  async testConnection(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<{ ok: boolean; errorMessage?: string }> {
    try {
      const result = await this.validatePhoneNumber(phoneNumberId, accessToken);
      return result.isWhatsAppBusiness
        ? { ok: true }
        : { ok: false, errorMessage: 'Phone number not found or no access' };
    } catch (err) {
      return { ok: false, errorMessage: (err as Error).message };
    }
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 2,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.ok || response.status < 500) {
          return response;
        }
        lastError = new Error(`Meta API returned ${response.status}`);
      } catch (err) {
        lastError = err as Error;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
      }
    }

    this.logger.error('Meta API request failed after retries', lastError?.message);
    throw lastError ?? new Error('Meta API request failed');
  }
}
