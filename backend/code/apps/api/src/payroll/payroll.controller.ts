import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PayrollService } from './payroll.service.js';
import { ListPayslipsQueryDto } from './dto/list-payslips.dto.js';
import { MarkPaidDto } from './dto/mark-paid.dto.js';
import { RunPayrollDto } from './dto/run-payroll.dto.js';

@Controller('payroll')
@UseGuards(PermissionGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('run')
  @RequirePermission('payroll.manage')
  async runMonthlyPayroll(@Body() dto: RunPayrollDto) {
    return this.payrollService.runMonthlyPayroll(dto.month, dto.year, {
      allowancePercent: dto.allowancePercent,
      deductionPercent: dto.deductionPercent,
      notes: dto.notes,
      processedBy: dto.processedBy,
    });
  }

  @Get('payslips')
  @RequirePermission('payroll.read')
  async listPayslips(@Query() query: ListPayslipsQueryDto) {
    return this.payrollService.listPayslips(query);
  }

  @Get('payslips/:id')
  @RequirePermission('payroll.read')
  async getPayslip(@Param('id') id: string) {
    return this.payrollService.getPayslip(id);
  }

  @Post('payslips/:id/paid')
  @RequirePermission('payroll.manage')
  async markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.payrollService.markPaid(id, dto.processedBy);
  }
}
