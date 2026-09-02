import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface LabSpecimenLabelData {
  requisitionId: string;
  requisitionNumber: string;
  patientName: string;
  patientNo: string;
  testName: string;
  specimenType: string;
  collectedAt: string | null;
}

// Same small pre-cut label size as the patient ID label (Development-Standards.md §129) — a
// specimen label is affixed to a sample tube/container, not a report page.
const LABEL_PAGE_SIZE = { width: 288, height: 144 };

/**
 * Pure builder for the lab specimen label PDF, printed at sample collection and affixed to the
 * tube/container. QR encodes the requisitionId — the same id lab-requisitions-list/detail already
 * look a requisition up by, so scanning it during result entry finds the right record directly.
 */
export function buildLabSpecimenLabelDocument(data: LabSpecimenLabelData): PdfDocumentDefinition {
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
            { text: data.testName, style: 'field' },
            { text: data.specimenType, style: 'field' },
            { text: data.collectedAt ? `Collected: ${data.collectedAt}` : 'Not yet collected', style: 'field' },
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
