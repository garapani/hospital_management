import { buildRadiologyReportDocument, RadiologyReportData } from './radiology-report-document.js';

describe('buildRadiologyReportDocument', () => {
  const data: RadiologyReportData = {
    patientName: 'Jane Roe',
    patientPhone: '9876500000',
    requisitionNumber: 'RAD-2025-00001',
    imagingItemName: 'Chest X-Ray PA',
    procedureCode: 'XR-CHEST',
    indication: 'Persistent cough',
    reportText: 'No acute cardiopulmonary abnormality.',
    verifiedBy: 'Dr. Rao',
    verifiedAt: '2025-06-02T09:00:00.000Z',
  };

  it('lays out brand, title, patient block and verified footer', () => {
    const doc = buildRadiologyReportDocument(data);
    const content = doc.content as unknown[];

    expect(content[0]).toEqual({ text: 'VAIDYA', style: 'brand' });
    expect(content[1]).toEqual({ text: 'Radiology Report', style: 'title' });

    const columns = content[3] as { columns: Array<Array<{ text: string }>> };
    const columnText = columns.columns.flat().map((c) => c.text);
    expect(columnText).toContain('Patient: Jane Roe');
    expect(columnText).toContain('Requisition: RAD-2025-00001');
    expect(columnText).toContain('Procedure: Chest X-Ray PA');
    expect(columnText).toContain('Procedure Code: XR-CHEST');

    const lastTwo = content.slice(-2) as Array<{ text: string; style: string }>;
    expect(lastTwo[0]).toEqual({ text: 'Verified by: Dr. Rao', style: 'footer' });
    expect(lastTwo[1]).toEqual({ text: 'Verified at: 2025-06-02T09:00:00.000Z', style: 'footer' });
  });

  it('puts indication and report text into the two-row table', () => {
    const doc = buildRadiologyReportDocument(data);
    const content = doc.content as unknown[];
    const table = (content[5] as { table: { body: unknown[][] } }).table;

    expect(table.body[0]).toEqual([
      { text: 'Indication', style: 'tableHeader' },
      'Persistent cough',
    ]);
    expect(table.body[1]).toEqual([
      { text: 'Findings / Report', style: 'tableHeader' },
      { text: 'No acute cardiopulmonary abnormality.', style: 'reportText' },
    ]);
  });

  it('omits the procedure-code line and shows a placeholder indication when absent', () => {
    const doc = buildRadiologyReportDocument({ ...data, procedureCode: null, indication: null });
    const content = doc.content as unknown[];
    const columns = content[3] as { columns: Array<Array<{ text: string }>> };
    const columnText = columns.columns.flat().map((c) => c.text);

    expect(columnText).not.toContain('Procedure Code:');
    const table = (content[5] as { table: { body: unknown[][] } }).table;
    expect(table.body[0][1]).toEqual({ text: '—', color: '#94a3b8' });
  });
});
