import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';

/**
 * MVP acceptance walk: the complete registration → visit → bill → lab/radiology/pharmacy flow for
 * one hospital, exercised end-to-end through real HTTP against the real AppModule (middleware,
 * guards, subscribers — nothing mocked). Proves the Basic-package modules work *together*, not
 * just in isolation: order completion drives charge-capture into a patient invoice, pharmacy
 * dispensing decrements stock, admission/appointment creation raise notifications, payroll
 * computes payslips from the employee master.
 */
describe('MVP end-to-end workflow (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;
  let staffId: string;

  const BASIC_PERMISSIONS = [
    'patients.create',
    'patients.read',
    'patients.update',
    'appointment.manage',
    'appointment.read',
    'admission.manage',
    'admission.read',
    'order.manage',
    'order.read',
    'billing.manage',
    'lab.catalog.manage',
    'lab.read',
    'lab.requisition.create',
    'lab.result.enter',
    'lab.result.verify',
    'radiology.catalog.manage',
    'radiology.read',
    'radiology.requisition.create',
    'radiology.report.enter',
    'radiology.report.verify',
    'inventory.catalog.manage',
    'inventory.read',
    'inventory.purchase-order.create',
    'inventory.goods-receipt.enter',
    'inventory.requisition.create',
    'inventory.dispatch.fulfill',
    'pharmacy.read',
    'pharmacy.dispensing.create',
    'pharmacy.dispensing.dispense',
    'vitals.manage',
    'vitals.read',
    'encounter.manage',
    'encounter.read',
    'triage.read',
    'employee.read',
    'employee.manage',
    'payroll.read',
    'payroll.manage',
    'reporting.read',
    'master-data.manage',
    'identity.accounts.manage',
  ];

  const http = {
    get: (url: string) =>
      request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: unknown) =>
      request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send(body as object),
    patch: (url: string, body: unknown) =>
      request(app.getHttpServer()).patch(url).set('Authorization', `Bearer ${token}`).send(body as object),
  };

  function expectOk(res: request.Response, status = 200): request.Response {
    if (res.status !== status) {
      throw new Error(`Expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 500)}`);
    }
    return res;
  }

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'mvp_workflow' });
    staffId = '00000000-0000-0000-0000-0000000000aa';
    token = await signTestToken({
      sub: staffId,
      hospitalId: ctx.tenantId,
      permissions: BASIC_PERMISSIONS,
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('walks registration → visit → bill → lab/radiology/pharmacy end to end', async () => {
    // --- Registration: patient + appointment + clinical basics -------------------------------
    const patientRes = expectOk(await http.post('/patients', {
      firstName: 'Anita',
      lastName: 'Sharma',
      gender: 'Female',
      dateOfBirth: '1985-04-12',
      phoneNumber: '9811000001',
    }), 201);
    const patientId = patientRes.body.id as string;

    const appointmentRes = expectOk(await http.post('/appointments', {
      firstName: 'Anita',
      lastName: 'Sharma',
      contactNumber: '9811000001',
      appointmentDate: '2026-09-01',
      appointmentTime: '10:30',
      appointmentType: 'OPD',
      reason: 'Fever and cough',
    }), 201);
    expect(appointmentRes.body.patientId).toBeDefined();

    // Vitals + encounter (notes/diagnosis/prescription) for the visit record.
    expectOk(await http.post('/vitals', {
      patientId,
      temperature: 38.4,
      pulse: 92,
      bpSystolic: 120,
      bpDiastolic: 80,
      respiratoryRate: 20,
      spO2: 97,
    }), 201);
    expectOk(await http.post('/encounters/notes', {
      patientId,
      doctorId: staffId,
      chiefComplaint: 'Fever and cough for 3 days',
      plan: 'CBC, paracetamol; review in 3 days',
    }), 201);
    expectOk(await http.post('/encounters/diagnoses', {
      patientId,
      doctorId: staffId,
      description: 'Acute upper respiratory tract infection',
      isPrimary: true,
    }), 201);
    expectOk(await http.post('/encounters/prescriptions', {
      patientId,
      doctorId: staffId,
      medicationName: 'Paracetamol 500mg',
      dosage: '500 mg',
      frequency: '1-0-1',
      route: 'Oral',
      durationDays: 3,
    }), 201);

    // --- Visit: ward/bed + admission ----------------------------------------------------------
    const wardRes = expectOk(await http.post('/wards', {
      wardCode: 'W-A1',
      wardName: 'General Ward A',
      bedCapacity: 20,
    }), 201);
    const bedRes = expectOk(await http.post(`/wards/${wardRes.body.id}/beds`, {
      bedNumber: 'A-101',
    }), 201);
    const admissionRes = expectOk(await http.post('/admissions', {
      patientId,
      admissionSource: 'OPD',
      admittingDoctorId: staffId,
      bedId: bedRes.body.id,
    }), 201);
    expect(admissionRes.body.id).toBeDefined();

    // --- Ordering: lab + pharmacy + radiology on one order ------------------------------------
    const orderRes = expectOk(await http.post('/orders', {
      patientId,
      items: [
        { itemType: 'Lab', itemDescription: 'Complete Blood Count' },
        { itemType: 'Pharmacy', itemDescription: 'Paracetamol 500mg x10' },
        { itemType: 'Radiology', itemDescription: 'Chest X-Ray PA' },
      ],
    }), 201);
    const items = orderRes.body.items as Array<{ id: string; itemType: string }>;
    const labOrderItem = items.find((i) => i.itemType === 'Lab')!;
    const pharmacyOrderItem = items.find((i) => i.itemType === 'Pharmacy')!;
    const radiologyOrderItem = items.find((i) => i.itemType === 'Radiology')!;

    // --- Stock for pharmacy: category → sub-category → item → vendor → PO → goods receipt -------
    const invCat = expectOk(await http.post('/inventory/categories', { name: 'Pharmaceuticals' }), 201);
    const invSubCat = expectOk(
      await http.post('/inventory/sub-categories', { categoryId: invCat.body.id, name: 'Analgesics' }),
      201,
    );
    const itemRes = expectOk(await http.post('/inventory/items', {
      subCategoryId: invSubCat.body.id,
      name: 'Paracetamol 500mg',
      code: 'PARA-500',
      unitOfMeasure: 'tablet',
      salePrice: 2,
    }), 201);
    const vendorRes = expectOk(await http.post('/inventory/vendors', { name: 'MediSupply Co' }), 201);
    const poRes = expectOk(await http.post('/inventory/purchase-orders', {
      vendorId: vendorRes.body.id,
      items: [{ itemId: itemRes.body.id, orderedQuantity: 100, unitCost: 1 }],
    }), 201);
    const poItem = poRes.body.items[0];
    expectOk(await http.post(`/inventory/purchase-orders/items/${poItem.id}/goods-receipt`, {
      batchNumber: 'B-1001',
      unitCost: 1,
      receivedQuantity: 100,
    }), 201);

    // --- Lab catalog + full workflow (requisition → collect → results → verify) -----------------
    const labCat = expectOk(await http.post('/lab/categories', { name: 'Hematology' }), 201);
    const labTest = expectOk(await http.post('/lab/tests', {
      categoryId: labCat.body.id,
      name: 'Complete Blood Count',
      code: 'CBC',
      specimenType: 'Blood',
      price: 300,
    }), 201);
    const component = expectOk(
      await http.post(`/lab/tests/${labTest.body.id}/components`, { name: 'Hemoglobin', unit: 'g/dL' }),
      201,
    );
    const labReq = expectOk(await http.post('/lab/requisitions', {
      orderItemId: labOrderItem.id,
      testId: labTest.body.id,
      specimenType: 'Blood',
    }), 201);
    expectOk(await http.patch(`/lab/requisitions/${labReq.body.id}/collect-sample`, {}));
    expectOk(await http.post(`/lab/requisitions/${labReq.body.id}/results`, {
      componentId: component.body.id,
      value: '13.2',
    }), 201);
    expectOk(await http.patch(`/lab/requisitions/${labReq.body.id}/verify`, {}));

    // --- Radiology catalog + full workflow ------------------------------------------------------
    const radType = expectOk(await http.post('/radiology/types', { name: 'X-Ray' }), 201);
    const radItem = expectOk(await http.post('/radiology/items', {
      imagingTypeId: radType.body.id,
      name: 'Chest X-Ray PA',
      procedureCode: 'XR-CHEST',
      price: 450,
    }), 201);
    const radReq = expectOk(await http.post('/radiology/requisitions', {
      orderItemId: radiologyOrderItem.id,
      imagingItemId: radItem.body.id,
    }), 201);
    expectOk(await http.patch(`/radiology/requisitions/${radReq.body.id}/mark-scanned`, {}));
    expectOk(await http.post(`/radiology/requisitions/${radReq.body.id}/report`, {
      reportText: 'No acute cardiopulmonary abnormality.',
      indication: 'Persistent cough',
    }), 201);
    expectOk(await http.patch(`/radiology/requisitions/${radReq.body.id}/verify`, {}));

    // --- Pharmacy dispensing (stock-backed) → dispense -------------------------------------------
    const dispensing = expectOk(await http.post('/pharmacy/dispensings', {
      orderItemId: pharmacyOrderItem.id,
      inventoryItemId: itemRes.body.id,
      quantity: 10,
    }), 201);
    expectOk(await http.patch(`/pharmacy/dispensings/${dispensing.body.id}/dispense`, {}));

    // The console list views must work too — these are the exact queries the Pharmacy and
    // Radiology pages issue, and both previously 500'd on a non-existent relation join.
    const pharmacyList = expectOk(await http.get('/pharmacy/dispensings?page=1&limit=10'));
    expect(pharmacyList.body.data).toHaveLength(1);
    expect(pharmacyList.body.data[0].orderItem.itemDescription).toBe('Paracetamol 500mg x10');
    const radiologyList = expectOk(await http.get('/radiology/requisitions?page=1&limit=10'));
    expect(radiologyList.body.data).toHaveLength(1);

    // --- Billing: charge-capture produced one invoice with three lines; pay it -------------------
    const invoicesRes = expectOk(await http.get(`/billing/invoices?patientId=${patientId}`));
    expect(invoicesRes.body.data).toHaveLength(1);
    const invoice = invoicesRes.body.data[0];
    expect(invoice.status).toBe('Unpaid');
    // CBC 300 + X-ray 450 + paracetamol 2 (charge-capture lines are quantity 1 × catalog price).
    expect(invoice.totalAmount).toBe(300 + 450 + 2);

    const detailRes = expectOk(await http.get(`/billing/invoices/${invoice.id}`));
    const lineDescriptions = (detailRes.body.items as Array<{ description: string }>).map((i) => i.description);
    expect(lineDescriptions).toEqual(
      expect.arrayContaining(['Complete Blood Count', 'Chest X-Ray PA', 'Paracetamol 500mg']),
    );

    expectOk(await http.post(`/billing/invoices/${invoice.id}/payments`, {
      amount: invoice.totalAmount,
      paymentMode: 'Cash',
    }), 201);
    const afterPayment = expectOk(await http.get(`/billing/invoices/${invoice.id}`));
    expect(afterPayment.body.status).toBe('Paid');

    // Charge-capture recovery endpoint: re-running for an already-charged item is a safe no-op.
    const reRun = expectOk(await http.post('/billing/invoices/charge-capture', {
      orderItemId: labOrderItem.id,
    }), 201);
    expect(reRun.body).toEqual({ captured: false, reason: 'already-charged' });

    // --- HR: employee master + payroll run -------------------------------------------------------
    expectOk(await http.post('/employees', {
      firstName: 'Kiran',
      lastName: 'Joshi',
      joinDate: '2024-01-15',
      employmentType: 'FullTime',
      monthlyBasicSalary: 25000,
      designation: 'Staff Nurse',
    }), 201);
    const payrollRes = expectOk(await http.post('/payroll/run', { month: 8, year: 2026 }), 201);
    expect(payrollRes.body.length).toBe(1);
    const payslips = expectOk(await http.get('/payroll/payslips?page=1&limit=10'));
    expect(payslips.body.data).toHaveLength(1);
    expect(payslips.body.data[0].netAmount).toBeGreaterThan(0);

    // --- Notifications: admission + appointment creation fired subscribers -------------------------
    const notifications = expectOk(await http.get('/notifications/summary'));
    expect(notifications.body.unreadCount).toBeGreaterThan(0);

    // --- Reporting: events were archived -----------------------------------------------------------
    expectOk(await http.get('/reporting/dashboard/event-counts?from=2026-08-01&to=2026-12-31'));
  }, 120_000);
});
