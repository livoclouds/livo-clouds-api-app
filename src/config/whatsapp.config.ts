import { registerAs } from '@nestjs/config';

export default registerAs('whatsapp', () => ({
  metaAppSecret: process.env.WHATSAPP_META_APP_SECRET ?? '',
  encryptionKey: process.env.WHATSAPP_ENCRYPTION_KEY ?? '',
  graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION ?? 'v20.0',
}));
