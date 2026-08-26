import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface LabReportResultRow {
  componentName: string;
  unit: string | null;
  value: string;
  referenceRange: string | null;
  isAbnormal: boolean;
}

export interface LabReportData {
  patientName: string;
  patientPhone: string;
  requisitionNumber: string;
  testName: string;
  specimenType: string;
  verifiedBy: string;
  verifiedAt: string;
  results: LabReportResultRow[];
}

/**
 * Pure builder for the lab report PDF — no pdfmake dependency here, so the structure is unit
 * testable without rendering.
 */
export function buildLabReportDocument(data: LabReportData): PdfDocumentDefinition {
  const resultTableBody = [
    [
      { text: 'Component', style: 'tableHeader' },
      { text: 'Result', style: 'tableHeader' },
      { text: 'Unit', style: 'tableHeader' },
      { text: 'Reference Range', style: 'tableHeader' },
      { text: 'Flag', style: 'tableHeader' },
    ],
    ...data.results.map((row) => [
      row.componentName,
      row.value,
      row.unit ?? '',
      row.referenceRange ?? '',
      row.isAbnormal ? { text: 'ABNORMAL', bold: true, color: '#b91c1c' } : '',
    ]),
  ];

  return {
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Laboratory Report', style: 'title' },
      { text: '\n' },
      {
        columns: [
          [
            { text: `Patient: ${data.patientName}`, style: 'field' },
            { text: `Phone: ${data.patientPhone}`, style: 'field' },
          ],
          [
            { text: `Requisition: ${data.requisitionNumber}`, style: 'field' },
            { text: `Test: ${data.testName}`, style: 'field' },
            { text: `Specimen: ${data.specimenType}`, style: 'field' },
          ],
        ],
      },
      { text: '\n' },
      { table: { headerRows: 1, widths: ['*', '*', '*', '*', '*'], body: resultTableBody } },
      { text: '\n' },
      { text: `Verified by: ${data.verifiedBy}`, style: 'footer' },
      { text: `Verified at: ${data.verifiedAt}`, style: 'footer' },
    ],
    styles: {
      brand: { fontSize: 18, bold: true, color: '#006D77' },
      title: { fontSize: 14, bold: true, margin: [0, 4, 0, 12] },
      field: { fontSize: 10, margin: [0, 2, 0, 2] },
      tableHeader: { bold: true, fillColor: '#E8F5F5' },
      footer: { fontSize: 9, color: '#475569', margin: [0, 2, 0, 0] },
    },
    defaultStyle: { fontSize: 10 },
  };
}
