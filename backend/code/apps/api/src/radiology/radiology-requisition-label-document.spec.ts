import { buildRadiologyRequisitionLabelDocument, RadiologyRequisitionLabelData } from './radiology-requisition-label-document.js';

describe('buildRadiologyRequisitionLabelDocument', () => {
  const data: RadiologyRequisitionLabelData = {
    requisitionId: '00000000-0000-4000-8000-000000000003',
    requisitionNumber: 'RAD-2026-00001',
    patientName: 'Jane Doe',
    patientNo: 'PAT-2026-00001',
    imagingItemName: 'Chest X-Ray',
    scannedAt: '2026-09-02 11:00',
  };

  it('sizes the page as a small label, not a report page', () => {
    const doc = buildRadiologyRequisitionLabelDocument(data);
    expect(doc.pageSize).toEqual({ width: 288, height: 144 });
  });

  it('lays out brand, patient, requisition, procedure, and scan time in the text column', () => {
    const doc = buildRadiologyRequisitionLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn.map((c) => c.text)).toEqual([
      'VAIDYA',
      'Jane Doe',
      '#PAT-2026-00001',
      'Req: RAD-2026-00001',
      'Chest X-Ray',
      'Scanned: 2026-09-02 11:00',
    ]);
  });

  it('shows "Not yet scanned" when there is no scan timestamp', () => {
    const doc = buildRadiologyRequisitionLabelDocument({ ...data, scannedAt: null });
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn[5].text).toBe('Not yet scanned');
  });

  it('encodes requisitionId in the QR code', () => {
    const doc = buildRadiologyRequisitionLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const qrCell = columns.columns[1] as { qr: string };

    expect(qrCell.qr).toBe('00000000-0000-4000-8000-000000000003');
  });
});
