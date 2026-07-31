import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';

@Module({
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
