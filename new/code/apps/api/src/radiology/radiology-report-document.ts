import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface RadiologyReportData {
  patientName: string;
  patientPhone: string;
  requisitionNumber: string;
  imagingItemName: string;
  procedureCode: string | null;
  indication: string | null;
  reportText: string;
  verifiedBy: string;
  verifiedAt: string;
}

/**
 * Pure builder for the radiology report PDF — no pdfmake dependency here, so the structure is
 * unit testable without rendering.
 */
export function buildRadiologyReportDocument(data: RadiologyReportData): PdfDocumentDefinition {
  return {
    content: [
      { text: 'VAIDYA', style: 'brand' },
      { text: 'Radiology Report', style: 'title' },
      { text: '\n' },
      {
        columns: [
          [
            { text: `Patient: ${data.patientName}`, style: 'field' },
            { text: `Phone: ${data.patientPhone}`, style: 'field' },
          ],
          [
            { text: `Requisition: ${data.requisitionNumber}`, style: 'field' },
            { text: `Procedure: ${data.imagingItemName}`, style: 'field' },
            ...(data.procedureCode
              ? [{ text: `Procedure Code: ${data.procedureCode}`, style: 'field' }]
              : []),
          ],
        ],
      },
      { text: '\n' },
      {
        table: {
          headerRows: 1,
          widths: ['20%', '80%'],
          body: [
            [
              { text: 'Indication', style: 'tableHeader' },
              data.indication?.trim() ? data.indication : { text: '—', color: '#94a3b8' },
            ],
            [
              { text: 'Findings / Report', style: 'tableHeader' },
              { text: data.reportText, style: 'reportText' },
            ],
          ],
        },
      },
      { text: '\n' },
      { text: `Verified by: ${data.verifiedBy}`, style: 'footer' },
      { text: `Verified at: ${data.verifiedAt}`, style: 'footer' },
    ],
    styles: {
      brand: { fontSize: 18, bold: true, color: '#006D77' },
      title: { fontSize: 14, bold: true, margin: [0, 4, 0, 12] },
      field: { fontSize: 10, margin: [0, 2, 0, 2] },
      tableHeader: { bold: true, fillColor: '#E8F5F5' },
      reportText: { fontSize: 10, lineHeight: 1.5 },
      footer: { fontSize: 9, color: '#475569', margin: [0, 2, 0, 0] },
    },
    defaultStyle: { fontSize: 10 },
  };
}
