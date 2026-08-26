import { Module } from '@nestjs/common';
import { EmployeeService } from './employee.service.js';
import { EmployeeController } from './employee.controller.js';
import { EmployeeNumberGeneratorService } from './employee-number-generator.service.js';

@Module({
  controllers: [EmployeeController],
  providers: [EmployeeService, EmployeeNumberGeneratorService],
  exports: [EmployeeService],
})
export class EmployeeModule {}
