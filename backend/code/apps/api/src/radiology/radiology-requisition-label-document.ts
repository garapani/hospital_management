import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface RadiologyRequisitionLabelData {
  requisitionId: string;
  requisitionNumber: string;
  patientName: string;
  patientNo: string;
  imagingItemName: string;
  scannedAt: string | null;
}

// Same small pre-cut label size as the patient ID / lab specimen labels
// (Development-Standards.md §129) — attached to the patient's imaging paperwork/film envelope,
// not a report page.
const LABEL_PAGE_SIZE = { width: 288, height: 144 };

/**
 * Pure builder for the radiology requisition label PDF, printed to identify the patient/procedure
 * on film envelopes or paperwork before (or at) scan time. QR encodes the requisitionId — the
 * same id radiology-requisitions-list/detail already look a requisition up by.
 */
export function buildRadiologyRequisitionLabelDocument(data: RadiologyRequisitionLabelData): PdfDocumentDefinition {
  return {
    pageSize: LABEL_PAGE_SIZE,
    pageMargins: [10, 10, 10, 10],
    content: [
      {
        columns: [
          [
            { text: 'VAIDYA', style: 'brand' },
            { text: data.patientName, style: 'name' },
            { text: `#${data.patientNo}`, style: 'field' },
            { text: `Req: ${data.requisitionNumber}`, style: 'field' },
            { text: data.imagingItemName, style: 'field' },
            { text: data.scannedAt ? `Scanned: ${data.scannedAt}` : 'Not yet scanned', style: 'field' },
          ],
          { qr: data.requisitionId, fit: 60, alignment: 'right' },
        ],
      },
    ],
    styles: {
      brand: { fontSize: 9, bold: true, color: '#006D77' },
      name: { fontSize: 10, bold: true, margin: [0, 2, 0, 2] },
      field: { fontSize: 7, margin: [0, 1, 0, 0] },
    },
    defaultStyle: { fontSize: 7 },
  };
}
