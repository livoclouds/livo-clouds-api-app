import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AppModule } from './app.module';

let cachedApp: NestFastifyApplication | null = null;

async function bootstrap(): Promise<NestFastifyApplication> {
  if (cachedApp) return cachedApp;

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { rawBody: true, bufferLogs: true },
  );

  const configService = app.get(ConfigService);
  const corsOrigins = configService.get<string[]>('cors.origins', [
    'http://localhost:3000',
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(helmet as any, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(multipart as any, {
    limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  });

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  cachedApp = app;
  return app;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const app = await bootstrap();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.server.emit('request', req, res);
}
