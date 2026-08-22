/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { createApiValidationPipe } from './app/api-validation-pipe.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

// ESM has no ambient __dirname; assets/ is copied next to this compiled file
// by NxAppWebpackPlugin's `assets: ['./src/assets']` (webpack.config.cjs).
const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // Phase A of 2.14 (see new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md):
  // activates the class-validator decorators that already exist on ~9 DTOs (previously dead code —
  // no ValidationPipe was ever registered) and coerces typed-but-undecorated fields (e.g.
  // PaginationQueryDto's page/limit) via reflected design:type metadata.
  app.useGlobalPipes(createApiValidationPipe());
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const config = new DocumentBuilder()
    .setTitle('Vaidya')
    .setDescription('Vaidya Hospital Management Solution — API reference')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app as any, config);
  SwaggerModule.setup('api/docs', app as any, document, {
    customSiteTitle: 'Vaidya API Docs',
    customfavIcon: join(__dirname, 'assets', 'favicon.ico'),
    customCss: `
      body { background-color: #F0FDFD; }
      .swagger-ui .topbar { background-color: #006D77; }
      .swagger-ui .btn.authorize { border-color: #006D77; color: #006D77; }
      .swagger-ui .btn.authorize svg { fill: #006D77; }
      .swagger-ui .opblock-tag, .swagger-ui .opblock .opblock-summary-operation-id,
      .swagger-ui .opblock .opblock-summary-path, .swagger-ui .opblock .opblock-summary-path__deprecated {
        color: #006D77;
      }
      .swagger-ui .scheme-container { background-color: #F0FDFD; }
      .swagger-ui a.nostyle, .swagger-ui .info a { color: #006D77; }
    `,
  });

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
