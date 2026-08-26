import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ObservabilityLoggerModule, ObservabilityMetricsModule, MetricsService, metricsMiddleware } from '@hospital/observability';
import { TenantContextModule, TenantContextMiddleware, UNAUTHENTICATED_ROUTES } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { PlatformBillingModule } from '../platform-billing/platform-billing.module.js';
import { PlatformBrandingModule } from '../platform-branding/platform-branding.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { PatientPortalModule } from '../patient-portal/patient-portal.module.js';
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
import { FixedAssetsModule } from '../fixed-assets/fixed-assets.module.js';
import { InsuranceModule } from '../insurance/insurance.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { WardSupplyModule } from '../ward-supply/ward-supply.module.js';
import { NursingModule } from '../nursing/nursing.module.js';
import { OtModule } from '../ot/ot.module.js';
import { MaternityModule } from '../maternity/maternity.module.js';
import { CssdModule } from '../cssd/cssd.module.js';
import { EmployeeModule } from '../employee/employee.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { FractionModule } from '../fraction/fraction.module.js';
import { HelpdeskModule } from '../helpdesk/helpdesk.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';
import { SsuModule } from '../ssu/ssu.module.js';
import { VaccinationModule } from '../vaccination/vaccination.module.js';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        // A single named 'default' throttler applies to every route; routes needing a tighter
        // ceiling (login/refresh/change-password) override it per-route via @Throttle({ default:
        // {...} }) — see AuthController. This used to be three named throttlers ('guest',
        // 'authenticated', 'admin'), but nothing in the codebase ever selected which one applied
        // per caller (no @SkipThrottle, no role-based tracker) — ThrottlerGuard runs every
        // configured named throttler on every request and requires all to pass, so all three
        // limits stacked on every route regardless of caller, and the tightest ('guest', 20/min)
        // silently became the ceiling for the entire API, including admins. Meanwhile
        // AuthController's own override named its bucket 'default', which matched none of the
        // three configured names, so `reflector.getAllAndOverride` never found it and the route
        // fell back to the (stacked) module defaults instead of the intended tighter limit —
        // making the auth-specific throttle a complete no-op on top of the global overcap.
        throttlers: [{ name: 'default', ttl: 60000, limit: Number(process.env['RATE_LIMIT_DEFAULT'] ?? 100) }],
        // Passing connection options (not a pre-built ioredis instance) so
        // ThrottlerStorageRedisService creates and owns the client itself — only then does its
        // onModuleDestroy() actually disconnect it (disconnectRequired is only set on the
        // constructor's own client, not one passed in already-built). Passing a pre-built client
        // here previously leaked an open connection on every app shutdown, hanging Jest.
        //
        // Default port is 6380, not Redis's usual 6379: docker-compose.dev.yml maps the dev
        // container's 6379 to host port 6380 (host port 6379 has nothing listening), matching how
        // database/data-source.ts already defaults DB_PORT to 5433 for the same reason. Without
        // this, any code path that unsets REDIS_HOST/REDIS_PORT (host-run dev server, or any test
        // that boots AppModule without .env loaded) connects nowhere, and every authenticated HTTP
        // request — which passes through this globally-registered ThrottlerGuard before reaching
        // any controller — hangs retrying (ioredis's default maxRetriesPerRequest) long enough to
        // blow past Jest's 5000ms test timeout, then eventually rejects with
        // MaxRetriesPerRequestError once given a longer runway. This is the actual cause of the
        // "encounters.controller.integration-spec.ts hangs" finding: it was the only clinical
        // controller spec exercising real authenticated HTTP end-to-end (see git history for
        // 2026-08-17) — sibling specs only assert 401-unauthorized paths, which AuthContextMiddleware
        // rejects before the request ever reaches this guard.
        //
        // Tests (NODE_ENV=test) use ThrottlerModule's default in-memory storage instead of Redis:
        // every integration spec boots its own AppModule, and if they all shared one Redis-backed
        // counter, a full-suite parallel run would aggregate every suite's request rate into the
        // same keys and trip the guest/authenticated limits (429) — intermittent, timing-dependent
        // failures across unrelated suites. In-memory storage is per-app-instance, so each suite's
        // counters are its own and the throttler still exercises the real guard path.
        ...(process.env['NODE_ENV'] === 'test'
          ? {}
          : {
              storage: new ThrottlerStorageRedisService({
                host: process.env['REDIS_HOST'] ?? 'localhost',
                port: Number(process.env['REDIS_PORT'] ?? 6380),
              }),
            }),
      }),
    }),
    ObservabilityLoggerModule,
    ObservabilityMetricsModule,
    TenantContextModule,
    AuthModule,
    TenantsModule,
    PlatformBillingModule,
    PlatformBrandingModule,
    PackagesModule,
    AuditModule,
    RbacModule,
    MasterDataModule,
    PatientsModule,
    PatientPortalModule,
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
    FixedAssetsModule,
    InsuranceModule,
    AccountingModule,
    WardSupplyModule,
    NursingModule,
    OtModule,
    MaternityModule,
    CssdModule,
    EmployeeModule,
    PayrollModule,
    FractionModule,
    HelpdeskModule,
    MarketingModule,
    SsuModule,
    VaccinationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  constructor(private readonly metricsService: MetricsService) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthContextMiddleware)
      .exclude(
        ...UNAUTHENTICATED_ROUTES.map((r) => ({
          path: r.path,
          method: RequestMethod[r.method as keyof typeof RequestMethod],
        })),
      )
      .forRoutes('*');
    consumer.apply(TenantContextMiddleware).forRoutes('*');
    // Metrics middleware must run before the route handlers to time them; it reads
    // req.authContext (populated by AuthContextMiddleware) and req.route (populated by Express).
    consumer.apply(metricsMiddleware(this.metricsService)).forRoutes('*');
  }
}
