import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportingEvent } from './entities/reporting-event.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([ReportingEvent])],
  providers: [],
  exports: [],
})
export class ReportingModule {}
