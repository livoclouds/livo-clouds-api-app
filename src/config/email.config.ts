import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  resendApiKey: process.env.RESEND_API_KEY,
  from: process.env.EMAIL_FROM ?? 'LivoClouds <noreply@livoclouds.com>',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
}));
