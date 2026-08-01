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
    // Guarded: some integration specs create and destroy their own separate DataSource instance
    // directly (via createDataSource()), independent of this DI-managed one — this only closes
    // the pool this module owns, and only if it's still open.
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
