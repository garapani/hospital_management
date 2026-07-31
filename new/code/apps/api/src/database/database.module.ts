import { Global, Module } from '@nestjs/common';
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
export class DatabaseModule {}
