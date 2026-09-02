import { Module } from '@nestjs/common';
import { ExcelService } from './excel.service.js';

@Module({
  providers: [ExcelService],
  exports: [ExcelService],
})
export class ExcelModule {}
