import { buildPharmacyDispensingLabelDocument, PharmacyDispensingLabelData } from './pharmacy-dispensing-label-document.js';

describe('buildPharmacyDispensingLabelDocument', () => {
  const data: PharmacyDispensingLabelData = {
    dispensingId: '00000000-0000-4000-8000-000000000004',
    dispensingNumber: 'PHD-2026-00001',
    patientName: 'Jane Doe',
    patientNo: 'PAT-2026-00001',
    drugName: 'Paracetamol 500mg',
    quantity: '2',
    unitOfMeasure: 'Tablet',
    dispensedAt: '2026-09-02 12:00',
  };

  it('sizes the page as a small label, not a report page', () => {
    const doc = buildPharmacyDispensingLabelDocument(data);
    expect(doc.pageSize).toEqual({ width: 288, height: 144 });
  });

  it('lays out brand, patient, dispensing number, drug/quantity, and dispensed time in the text column', () => {
    const doc = buildPharmacyDispensingLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn.map((c) => c.text)).toEqual([
      'VAIDYA',
      'Jane Doe',
      '#PAT-2026-00001',
      'Disp: PHD-2026-00001',
      'Paracetamol 500mg x 2 Tablet',
      'Dispensed: 2026-09-02 12:00',
    ]);
  });

  it('shows "Not yet dispensed" when there is no dispensed timestamp', () => {
    const doc = buildPharmacyDispensingLabelDocument({ ...data, dispensedAt: null });
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn[5].text).toBe('Not yet dispensed');
  });

  it('encodes dispensingId in the QR code', () => {
    const doc = buildPharmacyDispensingLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const qrCell = columns.columns[1] as { qr: string };

    expect(qrCell.qr).toBe('00000000-0000-4000-8000-000000000004');
  });
});
