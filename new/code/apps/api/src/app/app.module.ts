import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { VitalsModule } from '../clinical/vitals/vitals.module.js';
import { EncountersModule } from '../clinical/encounters/encounters.module.js';
import { TriageModule } from '../clinical/triage/triage.module.js';

@Module({
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
