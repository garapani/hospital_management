import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { TenantContextModule, TenantContextService } from '@hospital/tenant-context';

const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'ssn',
  '*.ssn',
  'dob',
  '*.dob',
  'diagnosis',
  '*.diagnosis',
  'phone',
  '*.phone',
  'email',
  '*.email',
  'address',
  '*.address',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [TenantContextModule],
      inject: [TenantContextService],
      useFactory: (tenantContext: TenantContextService) => {
        const nodeEnv = process.env['NODE_ENV'];
        const isProduction = nodeEnv === 'production';
        const isTest = nodeEnv === 'test';
        const level =
          process.env['LOG_LEVEL'] ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug');

        return {
          pinoHttp: {
            level: isTest ? 'silent' : level,
            // pino-http's default req/res serializers dump every header, query param, and the
            // remote address on every single log line — the mixin below already carries the
            // fields (tenantId/accountId/correlationId) actually needed to trace a request, so
            // this trims the rest down to what's useful for reading logs day-to-day.
            serializers: {
              req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            redact: {
              paths: REDACT_PATHS,
              censor: '[REDACTED]',
            },
            mixin: () => {
              const fields: Record<string, string> = {};
              const tenantId = tenantContext.getTenantId();
              const accountId = tenantContext.getAccountId();
              const correlationId = tenantContext.getCorrelationId();
              if (tenantId) fields['tenantId'] = tenantId;
              if (accountId) fields['accountId'] = accountId;
              if (correlationId) fields['correlationId'] = correlationId;
              return fields;
            },
            transport:
              !isProduction && !isTest
                ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
                : undefined,
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class ObservabilityLoggerModule {}
