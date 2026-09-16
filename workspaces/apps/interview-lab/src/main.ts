import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import type { Environment } from './config.js';

const app = await NestFactory.create(AppModule, {
  logger: new ConsoleLogger({ json: true }),
});
const config = app.get<ConfigService<Environment, true>>(ConfigService);

app.enableShutdownHooks();
await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
