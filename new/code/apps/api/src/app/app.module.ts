import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TenantContextModule, AuthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
