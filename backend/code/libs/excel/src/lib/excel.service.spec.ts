import ExcelJS from 'exceljs';
import { ExcelService } from './excel.service.js';

describe('ExcelService', () => {
  const service = new ExcelService();

  it('renders a single sheet to a valid .xlsx buffer with header row and data rows', async () => {
    const buffer = await service.renderWorkbook([
      {
        name: 'Events',
        columns: [
          { header: 'Event Type', key: 'eventType' },
          { header: 'Count', key: 'count' },
        ],
        rows: [
          { eventType: 'OrderPlaced', count: 5 },
          { eventType: 'InvoiceCreated', count: 3 },
        ],
      },
    ]);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // ZIP local file header magic bytes — .xlsx is a zip container.
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');

    const workbook = new ExcelJS.Workbook();
    // exceljs's own .d.ts pins Buffer's ArrayBufferLike generic differently than this workspace's
    // @types/node — same runtime Buffer, purely a structural mismatch between the two type defs.
    // Parameters<> pulls exceljs's own expected type instead of guessing at a cast target.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Events');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).getCell(1).value).toBe('Event Type');
    expect(sheet!.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(sheet!.getRow(2).getCell(1).value).toBe('OrderPlaced');
    expect(sheet!.getRow(2).getCell(2).value).toBe(5);
  });

  it('renders multiple sheets in one workbook', async () => {
    const buffer = await service.renderWorkbook([
      { name: 'Assets', columns: [{ header: 'Name', key: 'name' }], rows: [{ name: 'Cash' }] },
      { name: 'Liabilities', columns: [{ header: 'Name', key: 'name' }], rows: [{ name: 'Loan' }] },
    ]);

    const workbook = new ExcelJS.Workbook();
    // exceljs's own .d.ts pins Buffer's ArrayBufferLike generic differently than this workspace's
    // @types/node — same runtime Buffer, purely a structural mismatch between the two type defs.
    // Parameters<> pulls exceljs's own expected type instead of guessing at a cast target.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Assets', 'Liabilities']);
  });

  it('renders an empty sheet (no rows) without throwing', async () => {
    const buffer = await service.renderWorkbook([
      { name: 'Empty', columns: [{ header: 'Name', key: 'name' }], rows: [] },
    ]);

    const workbook = new ExcelJS.Workbook();
    // exceljs's own .d.ts pins Buffer's ArrayBufferLike generic differently than this workspace's
    // @types/node — same runtime Buffer, purely a structural mismatch between the two type defs.
    // Parameters<> pulls exceljs's own expected type instead of guessing at a cast target.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.getWorksheet('Empty')?.rowCount).toBe(1);
  });
});
