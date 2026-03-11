import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { AppModule } from './app.module';
import { ConfigService } from './common/config/config.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
    //only
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Api-Key'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Sync MongoDB indexes to pick up schema changes (e.g. sparse indexes)
  try {
    const connection = app.get<Connection>(getConnectionToken());
    for (const model of Object.values(connection.models)) {
      await model.syncIndexes();
    }
    logger.log('MongoDB indexes synced');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to sync MongoDB indexes: ${msg}`);
  }

  const configService = app.get(ConfigService);
  const port = configService.port;
  const host = configService.host;

  await app.listen(port, host);
  logger.log(`AlphArena API running on http://${host}:${port}`);
}

bootstrap();
