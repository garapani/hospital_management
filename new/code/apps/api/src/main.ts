/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  // Without this, OnModuleDestroy hooks (e.g. closing the database connection pools) never run
  // on SIGTERM/SIGINT — only when something explicitly calls app.close() (as tests do).
  app.enableShutdownHooks();
  // Defaults to allowing localhost:4200 and its subdomains; CORS_ORIGIN is a comma-separated allow-list
  // for any other origin (e.g. a real deployed frontend) once one exists.
  const corsOrigins = process.env['CORS_ORIGIN'] 
    ? process.env['CORS_ORIGIN'].split(',') 
    : [/^http:\/\/(.*?\.)?localhost:4200$/];
  app.enableCors({
    origin: corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
  });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const config = new DocumentBuilder()
    .setTitle('Hospital API')
    .setDescription('The Hospital Management API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app as any, config);
  SwaggerModule.setup('api/docs', app as any, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  Logger.log(
    `📄 Swagger documentation is available at: http://localhost:${port}/api/docs`,
  );
}

bootstrap();
