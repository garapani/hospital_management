import { Injectable } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { ExcelService } from '@hospital/excel';
import { AccountingService, BalanceSheetRow, IncomeStatementRow, TrialBalanceRow } from './accounting.service.js';
import { toCsv } from './accounting-csv.util.js';
import {
  buildBalanceSheetPdfDocument,
  buildIncomeStatementPdfDocument,
  buildTrialBalancePdfDocument,
} from './accounting-reports-pdf-document.js';

/**
 * CSV/PDF/Excel export for the read-only accounting reports (trial balance, income statement,
 * balance sheet). A separate service from AccountingService, not an addition to it — that
 * constructor is instantiated directly (not through Nest DI) by eight other modules' integration
 * specs, and adding PdfService/ExcelService there would ripple a signature change through all of
 * them for a concern only the reports care about.
 */
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly accountingService: AccountingService,
    private readonly pdfService: PdfService,
    private readonly excelService: ExcelService,
  ) {}

  private trialBalanceColumns() {
    return ['accountCode', 'accountName', 'accountType', 'debitTotal', 'creditTotal', 'balance'];
  }

  async exportTrialBalanceCsv(from?: string, to?: string): Promise<string> {
    const rows = await this.accountingService.trialBalance(from, to);
    return toCsv(
      rows.map((r) => ({ ...r })),
      this.trialBalanceColumns(),
    );
  }

  async exportTrialBalancePdf(from?: string, to?: string): Promise<Buffer> {
    const rows = await this.accountingService.trialBalance(from, to);
    return this.pdfService.render(buildTrialBalancePdfDocument(rows, from, to));
  }

  async exportTrialBalanceExcel(from?: string, to?: string): Promise<Buffer> {
    const rows: TrialBalanceRow[] = await this.accountingService.trialBalance(from, to);
    return this.excelService.renderWorkbook([
      {
        name: 'Trial Balance',
        columns: [
          { header: 'Code', key: 'accountCode', width: 14 },
          { header: 'Account', key: 'accountName', width: 30 },
          { header: 'Type', key: 'accountType', width: 14 },
          { header: 'Debit', key: 'debitTotal', width: 16 },
          { header: 'Credit', key: 'creditTotal', width: 16 },
          { header: 'Balance', key: 'balance', width: 16 },
        ],
        rows: rows.map((r) => ({ ...r })),
      },
    ]);
  }

  private incomeStatementRowsForCsv(income: IncomeStatementRow[], expenses: IncomeStatementRow[]) {
    return [
      ...income.map((r) => ({ section: 'Income', ...r })),
      ...expenses.map((r) => ({ section: 'Expenses', ...r })),
    ];
  }

  async exportIncomeStatementCsv(from?: string, to?: string): Promise<string> {
    const { income, expenses } = await this.accountingService.incomeStatement(from, to);
    return toCsv(this.incomeStatementRowsForCsv(income, expenses), ['section', 'accountCode', 'accountName', 'amount']);
  }

  async exportIncomeStatementPdf(from?: string, to?: string): Promise<Buffer> {
    const statement = await this.accountingService.incomeStatement(from, to);
    return this.pdfService.render(buildIncomeStatementPdfDocument(statement, from, to));
  }

  async exportIncomeStatementExcel(from?: string, to?: string): Promise<Buffer> {
    const { income, expenses, netIncome } = await this.accountingService.incomeStatement(from, to);
    return this.excelService.renderWorkbook([
      {
        name: 'Income Statement',
        columns: [
          { header: 'Section', key: 'section', width: 12 },
          { header: 'Code', key: 'accountCode', width: 14 },
          { header: 'Account', key: 'accountName', width: 30 },
          { header: 'Amount', key: 'amount', width: 16 },
        ],
        rows: [...this.incomeStatementRowsForCsv(income, expenses), { section: '', accountCode: '', accountName: 'Net Income', amount: netIncome }],
      },
    ]);
  }

  private balanceSheetRowsForCsv(assets: BalanceSheetRow[], liabilitiesAndEquity: BalanceSheetRow[]) {
    return [
      ...assets.map((r) => ({ section: 'Assets', ...r })),
      ...liabilitiesAndEquity.map((r) => ({ section: 'Liabilities & Equity', ...r })),
    ];
  }

  async exportBalanceSheetCsv(asOf?: string): Promise<string> {
    const { assets, liabilitiesAndEquity } = await this.accountingService.balanceSheet(asOf);
    return toCsv(this.balanceSheetRowsForCsv(assets, liabilitiesAndEquity), [
      'section',
      'accountCode',
      'accountName',
      'accountType',
      'amount',
    ]);
  }

  async exportBalanceSheetPdf(asOf?: string): Promise<Buffer> {
    const sheet = await this.accountingService.balanceSheet(asOf);
    return this.pdfService.render(buildBalanceSheetPdfDocument(sheet, asOf));
  }

  async exportBalanceSheetExcel(asOf?: string): Promise<Buffer> {
    const { assets, liabilitiesAndEquity, totalAssets, totalLiabilitiesAndEquity } = await this.accountingService.balanceSheet(asOf);
    return this.excelService.renderWorkbook([
      {
        name: 'Balance Sheet',
        columns: [
          { header: 'Section', key: 'section', width: 20 },
          { header: 'Code', key: 'accountCode', width: 14 },
          { header: 'Account', key: 'accountName', width: 30 },
          { header: 'Type', key: 'accountType', width: 14 },
          { header: 'Amount', key: 'amount', width: 16 },
        ],
        rows: [
          ...this.balanceSheetRowsForCsv(assets, liabilitiesAndEquity),
          { section: '', accountCode: '', accountName: 'Total Assets', accountType: '', amount: totalAssets },
          {
            section: '',
            accountCode: '',
            accountName: 'Total Liabilities & Equity',
            accountType: '',
            amount: totalLiabilitiesAndEquity,
          },
        ],
      },
    ]);
  }
}
