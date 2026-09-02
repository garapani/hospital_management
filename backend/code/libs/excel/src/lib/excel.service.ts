import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

export interface ExcelColumn {
  header: string;
  key: string;
  width?: number;
}

export interface ExcelSheet {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, string | number | boolean | null>[];
}

/**
 * Thin exceljs wrapper: renders one or more tabular sheets to an .xlsx Buffer. Platform lib —
 * domain modules (Reporting/Accounting exports) build their own column/row shape and call
 * renderWorkbook(); mirrors @hospital/pdf's "thin renderer, callers own the content" split.
 */
@Injectable()
export class ExcelService {
  async renderWorkbook(sheets: ExcelSheet[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);
      worksheet.columns = sheet.columns.map((column) => ({
        header: column.header,
        key: column.key,
        width: column.width ?? 20,
      }));
      worksheet.getRow(1).font = { bold: true };
      worksheet.addRows(sheet.rows);
    }
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }
}
