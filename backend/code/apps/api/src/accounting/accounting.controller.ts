import { Body, Controller, Get, Header, Param, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { AccountingService } from './accounting.service.js';
import { AccountingExportService } from './accounting-export.service.js';
import {
  CreateAccountDto,
  CreateJournalDto,
  ListJournalsQueryDto,
  UpdateAccountDto,
} from './dto/accounting.dto.js';

@Controller('accounting')
@UseGuards(PermissionGuard)
export class AccountingController {
  constructor(
    private readonly accountingService: AccountingService,
    private readonly accountingExportService: AccountingExportService,
  ) {}

  // Chart of accounts
  @Post('accounts')
  @RequirePermission('accounting.manage')
  async createAccount(@Body() dto: CreateAccountDto) {
    return this.accountingService.createAccount(dto);
  }

  @Get('accounts')
  @RequirePermission('accounting.read')
  async listAccounts() {
    return this.accountingService.listAccounts();
  }

  @Patch('accounts/:id')
  @RequirePermission('accounting.manage')
  async updateAccount(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountingService.updateAccount(id, dto);
  }

  @Patch('accounts/:id/deactivate')
  @RequirePermission('accounting.manage')
  async deactivateAccount(@Param('id') id: string) {
    return this.accountingService.deactivateAccount(id);
  }

  @Patch('accounts/:id/reactivate')
  @RequirePermission('accounting.manage')
  async reactivateAccount(@Param('id') id: string) {
    return this.accountingService.reactivateAccount(id);
  }

  // Journal entries
  @Post('journals')
  @RequirePermission('accounting.manage')
  async createJournal(@Body() dto: CreateJournalDto) {
    return this.accountingService.createJournal(dto);
  }

  @Get('journals')
  @RequirePermission('accounting.read')
  async listJournals(@Query() query: ListJournalsQueryDto) {
    return this.accountingService.listJournals(query);
  }

  @Get('journals/:id')
  @RequirePermission('accounting.read')
  async getJournal(@Param('id') id: string) {
    return this.accountingService.getJournal(id);
  }

  @Post('journals/:id/post')
  @RequirePermission('accounting.manage')
  async postJournal(@Param('id') id: string) {
    return this.accountingService.postJournal(id);
  }

  // Reports
  @Get('reports/trial-balance')
  @RequirePermission('accounting.read')
  async trialBalance(@Query() query: { from?: string; to?: string }) {
    return this.accountingService.trialBalance(query.from, query.to);
  }

  @Get('reports/income-statement')
  @RequirePermission('accounting.read')
  async incomeStatement(@Query() query: { from?: string; to?: string }) {
    return this.accountingService.incomeStatement(query.from, query.to);
  }

  @Get('reports/balance-sheet')
  @RequirePermission('accounting.read')
  async balanceSheet(@Query() query: { asOf?: string }) {
    return this.accountingService.balanceSheet(query.asOf);
  }

  // ---- Report exports ----

  @Get('reports/trial-balance/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="trial-balance.csv"')
  @RequirePermission('accounting.read')
  async exportTrialBalanceCsv(@Query() query: { from?: string; to?: string }) {
    return this.accountingExportService.exportTrialBalanceCsv(query.from, query.to);
  }

  @Get('reports/trial-balance/export.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="trial-balance.pdf"')
  @RequirePermission('accounting.read')
  async exportTrialBalancePdf(@Query() query: { from?: string; to?: string }): Promise<StreamableFile> {
    const buffer = await this.accountingExportService.exportTrialBalancePdf(query.from, query.to);
    return new StreamableFile(buffer);
  }

  @Get('reports/trial-balance/export.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="trial-balance.xlsx"')
  @RequirePermission('accounting.read')
  async exportTrialBalanceExcel(@Query() query: { from?: string; to?: string }): Promise<StreamableFile> {
    const buffer = await this.accountingExportService.exportTrialBalanceExcel(query.from, query.to);
    return new StreamableFile(buffer);
  }

  @Get('reports/income-statement/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="income-statement.csv"')
  @RequirePermission('accounting.read')
  async exportIncomeStatementCsv(@Query() query: { from?: string; to?: string }) {
    return this.accountingExportService.exportIncomeStatementCsv(query.from, query.to);
  }

  @Get('reports/income-statement/export.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="income-statement.pdf"')
  @RequirePermission('accounting.read')
  async exportIncomeStatementPdf(@Query() query: { from?: string; to?: string }): Promise<StreamableFile> {
    const buffer = await this.accountingExportService.exportIncomeStatementPdf(query.from, query.to);
    return new StreamableFile(buffer);
  }

  @Get('reports/income-statement/export.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="income-statement.xlsx"')
  @RequirePermission('accounting.read')
  async exportIncomeStatementExcel(@Query() query: { from?: string; to?: string }): Promise<StreamableFile> {
    const buffer = await this.accountingExportService.exportIncomeStatementExcel(query.from, query.to);
    return new StreamableFile(buffer);
  }

  @Get('reports/balance-sheet/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="balance-sheet.csv"')
  @RequirePermission('accounting.read')
  async exportBalanceSheetCsv(@Query() query: { asOf?: string }) {
    return this.accountingExportService.exportBalanceSheetCsv(query.asOf);
  }

  @Get('reports/balance-sheet/export.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="balance-sheet.pdf"')
  @RequirePermission('accounting.read')
  async exportBalanceSheetPdf(@Query() query: { asOf?: string }): Promise<StreamableFile> {
    const buffer = await this.accountingExportService.exportBalanceSheetPdf(query.asOf);
    return new StreamableFile(buffer);
  }

  @Get('reports/balance-sheet/export.xlsx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @Header('Content-Disposition', 'attachment; filename="balance-sheet.xlsx"')
  @RequirePermission('accounting.read')
  async exportBalanceSheetExcel(@Query() query: { asOf?: string }): Promise<StreamableFile> {
    const buffer = await this.accountingExportService.exportBalanceSheetExcel(query.asOf);
    return new StreamableFile(buffer);
  }
}
