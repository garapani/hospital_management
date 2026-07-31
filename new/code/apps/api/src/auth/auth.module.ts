import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantContextModule } from '@hospital/tenant-context';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    TenantContextModule,
    AccountsModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-insecure-secret-change-in-production',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
