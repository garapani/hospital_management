import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';

@Global()
@Module({
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
  ],
  exports: [DataSource],
})
export class DatabaseModule {}
