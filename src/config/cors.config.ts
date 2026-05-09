import { registerAs } from '@nestjs/config';

export default registerAs('cors', () => ({
  origins: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim()),
}));
