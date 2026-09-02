import { buildPatientIdLabelDocument, PatientIdLabelData } from './patient-id-label-document.js';

describe('buildPatientIdLabelDocument', () => {
  const data: PatientIdLabelData = {
    patientId: '00000000-0000-4000-8000-000000000001',
    patientNo: 'PAT-2026-00001',
    fullName: 'Jane Doe',
    gender: 'Female',
    dateOfBirth: '1990-05-12',
    bloodGroup: 'O+',
  };

  it('sizes the page as a small label, not a report page', () => {
    const doc = buildPatientIdLabelDocument(data);
    expect(doc.pageSize).toEqual({ width: 288, height: 144 });
  });

  it('lays out brand, name, patient number, gender/DOB, and blood group in the text column', () => {
    const doc = buildPatientIdLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn.map((c) => c.text)).toEqual([
      'VAIDYA',
      'Jane Doe',
      '#PAT-2026-00001',
      'Female · DOB 1990-05-12',
      'Blood Group: O+',
    ]);
  });

  it('omits the blood group line when not recorded', () => {
    const doc = buildPatientIdLabelDocument({ ...data, bloodGroup: null });
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn.map((c) => c.text)).not.toContain(expect.stringContaining('Blood Group'));
    expect(textColumn).toHaveLength(4);
  });

  it('omits the DOB suffix when not recorded, without a dangling separator', () => {
    const doc = buildPatientIdLabelDocument({ ...data, dateOfBirth: null });
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const textColumn = columns.columns[0] as Array<{ text: string }>;

    expect(textColumn[3].text).toBe('Female');
  });

  it('encodes patientId (not patientNo) in the QR code — the value every other screen looks patients up by', () => {
    const doc = buildPatientIdLabelDocument(data);
    const columns = (doc.content as unknown[])[0] as { columns: unknown[] };
    const qrCell = columns.columns[1] as { qr: string; fit: number };

    expect(qrCell.qr).toBe('00000000-0000-4000-8000-000000000001');
  });
});
