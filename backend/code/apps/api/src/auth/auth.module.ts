import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantContextModule } from '@hospital/tenant-context';
import { AccountsModule } from '../accounts/accounts.module.js';
import { PackagesModule } from '../packages/packages.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { resolveJwtSecret } from './jwt-secret.js';

@Module({
  imports: [
    TenantContextModule,
    AccountsModule,
    PackagesModule,
    TenantsModule,
    JwtModule.register({
      global: true,
      secret: resolveJwtSecret(),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
