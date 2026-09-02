import { buildLabSpecimenLabelDocument, LabSpecimenLabelData } from './lab-specimen-label-document.js';

describe('buildLabSpecimenLabelDocument', () => {
  const data: LabSpecimenLabelData = {
    requisitionId: '00000000-0000-4000-8000-000000000002',
    requisitionNumber: 'LAB-2026-00001',
    patientName: 'Jane Doe',
    patientNo: 'PAT-2026-00001',
    testName: 'Complete Blood Count',
    specimenType: 'Blood',
    collectedAt: '2026-09-02 10:15',
  };

  it('sizes the page as a small label, not a report page', () => {
    const doc = buildLabSpecimenLabelDocument(data);
    expect(doc.pageSize).toEqual({ width: 288, height: 144 });
  });

  it('lays out brand, patient, requisition, test, specimen, and collection time in the text column', () => {
    const doc = buildLabSpecimenLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn.map((c) => c.text)).toEqual([
      'VAIDYA',
      'Jane Doe',
      '#PAT-2026-00001',
      'Req: LAB-2026-00001',
      'Complete Blood Count',
      'Blood',
      'Collected: 2026-09-02 10:15',
    ]);
  });

  it('shows "Not yet collected" when the sample has no collection timestamp', () => {
    const doc = buildLabSpecimenLabelDocument({ ...data, collectedAt: null });
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn[6].text).toBe('Not yet collected');
  });

  it('encodes requisitionId in the QR code — the id result entry/verify screens already look up by', () => {
    const doc = buildLabSpecimenLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const qrCell = columns.columns[1] as { qr: string };

    expect(qrCell.qr).toBe('00000000-0000-4000-8000-000000000002');
  });
});
