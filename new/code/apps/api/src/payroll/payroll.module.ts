import { Module } from '@nestjs/common';
import { PayrollService } from './payroll.service.js';
import { PayrollController } from './payroll.controller.js';

@Module({
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
