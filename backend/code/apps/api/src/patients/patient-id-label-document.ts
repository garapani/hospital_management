import type { PdfDocumentDefinition } from '@hospital/pdf';

export interface PatientIdLabelData {
  patientId: string;
  patientNo: string;
  fullName: string;
  gender: string;
  dateOfBirth: string | null;
  bloodGroup: string | null;
}

// A wristband/file-folder label, not a report — much smaller than A4. 4in x 2in (a common
// pre-cut label size) in points (72pt/in).
const LABEL_PAGE_SIZE = { width: 288, height: 144 };

/**
 * Pure builder for the patient ID label PDF — no pdfmake dependency here, so the structure is
 * unit testable without rendering (same convention as buildLabReportDocument). Encodes patientId,
 * not patientNo, in the QR code: patientId is what every other screen in this app already uses to
 * look a patient up (routerLink, API calls), so a scan-to-open-chart flow needs that value, not
 * the human-readable number printed next to it.
 */
export function buildPatientIdLabelDocument(data: PatientIdLabelData): PdfDocumentDefinition {
  return {
    pageSize: LABEL_PAGE_SIZE,
    pageMargins: [10, 10, 10, 10],
    content: [
      {
        columns: [
          [
            { text: 'VAIDYA', style: 'brand' },
            { text: data.fullName, style: 'name' },
            { text: `#${data.patientNo}`, style: 'field' },
            { text: `${data.gender}${data.dateOfBirth ? ` · DOB ${data.dateOfBirth}` : ''}`, style: 'field' },
            ...(data.bloodGroup ? [{ text: `Blood Group: ${data.bloodGroup}`, style: 'field' }] : []),
          ],
          { qr: data.patientId, fit: 70, alignment: 'right' },
        ],
      },
    ],
    styles: {
      brand: { fontSize: 9, bold: true, color: '#006D77' },
      name: { fontSize: 11, bold: true, margin: [0, 2, 0, 2] },
      field: { fontSize: 8, margin: [0, 1, 0, 0] },
    },
    defaultStyle: { fontSize: 8 },
  };
}
