import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface MetaSendTextResponse {
  messaging_product: string;
  contacts: { input: string; wa_id: string }[];
  messages: { id: string }[];
}

export interface TemplateBodyParam {
  type: 'text';
  text: string;
}

export interface PhoneValidationResult {
  isWhatsAppBusiness: boolean;
  hasMessagesPermission: boolean;
  currentStatus: string;
}

export interface MetaMediaMetadata {
  url: string;
  mimeType: string;
  sha256: string;
  fileSize: number;
}

export interface MetaMediaStream {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: string | null;
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

  async sendTemplateMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    templateName: string,
    languageCode: string,
    bodyParams: TemplateBodyParam[] = [],
  ): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/messages`;
    const components = bodyParams.length
      ? [{ type: 'body', parameters: bodyParams }]
      : [];
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
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

  // ── Media (Phase 3) ──────────────────────────────────────────────────────────

  /**
   * Uploads a media buffer to Meta's media endpoint and returns its media ID.
   * The ID is later referenced by sendImageMessage / sendDocumentMessage.
   */
  async uploadMedia(
    phoneNumberId: string,
    accessToken: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<{ mediaId: string }> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/media`;

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    });

    const data = (await response.json()) as { id?: string };
    if (!data.id) {
      throw new Error('Meta media upload returned no media ID');
    }
    return { mediaId: data.id };
  }

  /**
   * Resolves a Meta media ID to a short-lived download URL plus metadata.
   * Returns null when Meta reports the media as missing/expired (HTTP 404).
   */
  async getMediaUrl(
    mediaId: string,
    accessToken: string,
  ): Promise<MetaMediaMetadata | null> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${mediaId}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Meta media lookup returned ${response.status}`);
    }

    const data = (await response.json()) as {
      url?: string;
      mime_type?: string;
      sha256?: string;
      file_size?: number;
    };
    if (!data.url) {
      return null;
    }
    return {
      url: data.url,
      mimeType: data.mime_type ?? 'application/octet-stream',
      sha256: data.sha256 ?? '',
      fileSize: data.file_size ?? 0,
    };
  }

  /**
   * Streams raw media bytes from a Meta lookaside URL. The body is returned
   * un-buffered so the caller can pipe it straight to the browser.
   */
  async downloadMedia(
    mediaUrl: string,
    accessToken: string,
  ): Promise<MetaMediaStream | null> {
    const response = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 404 || response.status === 410) {
      return null;
    }
    if (!response.ok || !response.body) {
      throw new Error(`Meta media download returned ${response.status}`);
    }

    return {
      stream: response.body,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: response.headers.get('content-length'),
    };
  }

  async sendImageMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    mediaId: string,
    caption?: string,
  ): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { id: mediaId, ...(caption ? { caption } : {}) },
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

  async sendDocumentMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    mediaId: string,
    filename: string,
    caption?: string,
  ): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: { id: mediaId, filename, ...(caption ? { caption } : {}) },
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
