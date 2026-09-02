import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface PharmacyDispensingLabelData {
  dispensingId: string;
  dispensingNumber: string;
  patientName: string;
  patientNo: string;
  drugName: string;
  quantity: string;
  unitOfMeasure: string;
  dispensedAt: string | null;
}

// Same small pre-cut label size as the patient ID / lab / radiology labels
// (Development-Standards.md §129) — attached to the dispensed medication packet, not a report page.
const LABEL_PAGE_SIZE = { width: 288, height: 144 };

/**
 * Pure builder for the pharmacy dispensing label PDF, printed to identify a dispensed medication
 * packet for the patient. QR encodes the dispensingId — the same id
 * pharmacy-dispensing-list/detail already look a dispensing up by.
 */
export function buildPharmacyDispensingLabelDocument(data: PharmacyDispensingLabelData): PdfDocumentDefinition {
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
            { text: `Disp: ${data.dispensingNumber}`, style: 'field' },
            { text: `${data.drugName} x ${data.quantity} ${data.unitOfMeasure}`, style: 'field' },
            { text: data.dispensedAt ? `Dispensed: ${data.dispensedAt}` : 'Not yet dispensed', style: 'field' },
          ],
          { qr: data.dispensingId, fit: 60, alignment: 'right' },
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
