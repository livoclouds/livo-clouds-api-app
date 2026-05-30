import { registerAs } from '@nestjs/config';

/**
 * Web Push (VAPID) configuration — shared across every notification channel.
 *
 * The same keypair powers both WhatsApp escalation pushes and the general
 * push-on-create dispatch for all notification types. Leave the keys blank to
 * disable Push dispatch entirely (the channel degrades gracefully).
 *
 * Generate a keypair once with: npx web-push generate-vapid-keys
 */
export default registerAs('webPush', () => ({
  publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '',
  privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '',
  subject: process.env.WEB_PUSH_VAPID_SUBJECT ?? 'mailto:contact@livoclouds.com',
}));
