import { Global, Module, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextModule } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';

@Global()
@Module({
  imports: [TenantContextModule],
  providers: [
    {
      provide: DataSource,
      useFactory: async () => {
        const ds = createDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    TenantConnectionService,
  ],
  exports: [DataSource, TenantConnectionService],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    // This guard is load-bearing, not defensive: several integration specs override this
    // provider with their own DataSource (`.overrideProvider(DataSource).useValue(ctx.dataSource)`)
    // and destroy it themselves via teardownTenantTestContext() before calling close(). TypeORM
    // throws CannotExecuteNotConnectedError on a second destroy() of the same instance, so this
    // check is what prevents that from crashing teardown, not just belt-and-braces.
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
