import { registerAs } from '@nestjs/config';

export default registerAs('whatsapp', () => ({
  metaAppSecret: process.env.WHATSAPP_META_APP_SECRET ?? '',
  encryptionKey: process.env.WHATSAPP_ENCRYPTION_KEY ?? '',
  graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v20.0',
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:3000',
  escalationTemplateName: process.env.WHATSAPP_ESCALATION_TEMPLATE_NAME ?? 'escalation_notification',
  escalationTemplateLanguage: process.env.WHATSAPP_ESCALATION_TEMPLATE_LANGUAGE ?? 'es_MX',
  mediaProxyRateLimit: Number(process.env.WHATSAPP_MEDIA_PROXY_RATE_LIMIT ?? 200),
  // Web Push (Phase 5) — VAPID keypair for admin push notifications.
  // Leave blank to disable Push dispatch (WhatsApp stays the primary channel).
  vapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.WEB_PUSH_VAPID_SUBJECT ?? 'mailto:contact@livoclouds.com',
}));
