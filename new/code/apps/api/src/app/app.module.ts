import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ObservabilityLoggerModule } from '@hospital/observability';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { VitalsModule } from '../clinical/vitals/vitals.module.js';
import { EncountersModule } from '../clinical/encounters/encounters.module.js';
import { TriageModule } from '../clinical/triage/triage.module.js';
import { AdmissionsModule } from '../admissions/admissions.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { LabModule } from '../lab/lab.module.js';
import { RadiologyModule } from '../radiology/radiology.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PharmacyModule } from '../pharmacy/pharmacy.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

const GLOBAL_RATE_LIMIT = process.env['NODE_ENV'] === 'test' ? 1_000_000 : 100;

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        // Role-based rate limiting: different limits for different user types
        // Default throttler applies to all authenticated users
        // Specific throttlers can be applied via @Throttle() decorator on routes
        throttlers: [
          { name: 'guest', ttl: 60000, limit: Number(process.env['RATE_LIMIT_GUEST'] ?? 20) },
          { name: 'authenticated', ttl: 60000, limit: Number(process.env['RATE_LIMIT_AUTHENTICATED'] ?? 100) },
          { name: 'admin', ttl: 60000, limit: Number(process.env['RATE_LIMIT_ADMIN'] ?? 1000) },
        ],
        // Passing connection options (not a pre-built ioredis instance) so
        // ThrottlerStorageRedisService creates and owns the client itself — only then does its
        // onModuleDestroy() actually disconnect it (disconnectRequired is only set on the
        // constructor's own client, not one passed in already-built). Passing a pre-built client
        // here previously leaked an open connection on every app shutdown, hanging Jest.
        storage: new ThrottlerStorageRedisService({
          host: process.env['REDIS_HOST'] ?? 'localhost',
          port: Number(process.env['REDIS_PORT'] ?? 6379),
        }),
      }),
    }),
    ObservabilityLoggerModule,
    TenantContextModule,
    AuthModule,
    TenantsModule,
    AuditModule,
    RbacModule,
    MasterDataModule,
    PatientsModule,
    AppointmentsModule,
    VitalsModule,
    EncountersModule,
    TriageModule,
    AdmissionsModule,
    OrdersModule,
    BillingModule,
    ReportingModule,
    LabModule,
    RadiologyModule,
    InventoryModule,
    PharmacyModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthContextMiddleware)
      .exclude(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/refresh', method: RequestMethod.POST },
      )
      .forRoutes('*');
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
