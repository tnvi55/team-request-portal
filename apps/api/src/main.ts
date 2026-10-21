import 'reflect-metadata';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';

// Local development reads the repo-root .env; containers receive real environment variables instead.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.API_PORT, config.API_HOST);
  new Logger('Bootstrap').log(`API ${config.INSTANCE_ID} listening on ${config.API_HOST}:${config.API_PORT}`);
}

void bootstrap();
