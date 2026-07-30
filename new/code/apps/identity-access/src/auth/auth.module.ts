import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    AccountsModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-insecure-secret-change-in-production',
    }),
  ],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
