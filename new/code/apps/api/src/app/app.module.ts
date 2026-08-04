import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
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

@Module({
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule, OrdersModule, BillingModule, ReportingModule],
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
