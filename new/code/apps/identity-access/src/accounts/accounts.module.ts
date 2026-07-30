import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextModule } from '@hospital/tenant-context';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { createDataSource } from '../database/data-source.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [TenantContextModule],
  providers: [
    AccountsService,
    TenantConnectionService,
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
  ],
  exports: [AccountsService, DataSource, TenantConnectionService],
})
export class AccountsModule {}
