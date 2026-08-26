import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { Prescription } from '../clinical/encounters/entities/prescription.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { LabRequisition } from '../lab/entities/lab-requisition.entity.js';
import { LabResult } from '../lab/entities/lab-result.entity.js';
import { LabTest } from '../lab/entities/lab-test.entity.js';
import { LabTestComponent } from '../lab/entities/lab-test-component.entity.js';
import { RadiologyRequisition } from '../radiology/entities/radiology-requisition.entity.js';
import { RadiologyImagingItem } from '../radiology/entities/radiology-imaging-item.entity.js';

export interface PatientResultView {
  type: 'lab' | 'radiology';
  requisitionNumber: string;
  testName: string;
  /** Lab only: one row per component (e.g. "Hemoglobin", "WBC Count") within the same test. */
  componentName: string | null;
  value: string | null;
  unit: string | null;
  isAbnormal: boolean | null;
  referenceRangeText: string | null;
  /** Radiology only: the free-text report. */
  reportText: string | null;
  verifiedAt: Date | null;
}

/** Patient-facing appointment view — excludes createdBy/updatedBy (internal staff account ids)
 *  and cancelledRemarks (an internal front-desk note, not written for the patient to read). */
export type PatientAppointmentView = Pick<
  Appointment,
  | 'id'
  | 'patientId'
  | 'firstName'
  | 'lastName'
  | 'contactNumber'
  | 'appointmentDate'
  | 'appointmentTime'
  | 'doctorId'
  | 'departmentId'
  | 'appointmentType'
  | 'status'
  | 'reason'
>;

/** Patient-facing invoice view — excludes createdBy/updatedBy and the internal billing `notes`
 *  field (not written for the patient to read). */
export type PatientInvoiceView = Pick<
  Invoice,
  | 'id'
  | 'patientId'
  | 'sourceAppointmentId'
  | 'sourceAdmissionId'
  | 'invoiceNumber'
  | 'financialYear'
  | 'subtotal'
  | 'discountAmount'
  | 'taxableAmount'
  | 'taxAmount'
  | 'totalAmount'
  | 'paidAmount'
  | 'status'
>;

/** Patient-facing prescription view — excludes createdBy/updatedBy; `notes` is kept (medication
 *  instructions are written for the patient, unlike the internal notes on the other two views). */
export type PatientPrescriptionView = Pick<
  Prescription,
  | 'id'
  | 'patientId'
  | 'appointmentId'
  | 'doctorId'
  | 'medicationName'
  | 'dosage'
  | 'frequency'
  | 'route'
  | 'durationDays'
  | 'notes'
  | 'status'
>;

const APPOINTMENT_VIEW_COLUMNS: (keyof PatientAppointmentView)[] = [
  'id',
  'patientId',
  'firstName',
  'lastName',
  'contactNumber',
  'appointmentDate',
  'appointmentTime',
  'doctorId',
  'departmentId',
  'appointmentType',
  'status',
  'reason',
];

const INVOICE_VIEW_COLUMNS: (keyof PatientInvoiceView)[] = [
  'id',
  'patientId',
  'sourceAppointmentId',
  'sourceAdmissionId',
  'invoiceNumber',
  'financialYear',
  'subtotal',
  'discountAmount',
  'taxableAmount',
  'taxAmount',
  'totalAmount',
  'paidAmount',
  'status',
];

const PRESCRIPTION_VIEW_COLUMNS: (keyof PatientPrescriptionView)[] = [
  'id',
  'patientId',
  'appointmentId',
  'doctorId',
  'medicationName',
  'dosage',
  'frequency',
  'route',
  'durationDays',
  'notes',
  'status',
];

@Injectable()
export class PatientPortalService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * The one source of truth for "which patient is this request allowed to see." Every method
   * below reads through this rather than accepting a patientId parameter — a patient-portal
   * caller can never widen its own scope by passing a different id, because there's nowhere in
   * this service that would accept one.
   */
  private requirePatientId(): string {
    const patientId = this.tenantContext.getPatientId();
    if (!patientId) {
      // Unreachable in production: PatientAuthGuard already rejects any request whose JWT isn't
      // accountType 'patient', and every such JWT carries a patientId claim (auth.service.ts
      // buildAccessPayload). A defensive check, not a real branch.
      throw new NotFoundException('No patient context for this account');
    }
    return patientId;
  }

  /**
   * Rejects a deactivated patient's session — a patient's own already-issued JWT stays valid
   * until it expires (no logout/revocation exists yet — a separate, already-tracked gap), so
   * deactivation must be enforced here, on every read, not just at login. Every method below
   * calls this before touching any other table.
   */
  private async assertPatientActive(manager: EntityManager, patientId: string): Promise<void> {
    const patient = await manager.getRepository(Patient).findOne({ where: { id: patientId, isActive: true } });
    if (!patient) {
      throw new NotFoundException('Patient record not found');
    }
  }

  async getMe(): Promise<Pick<Patient, 'id' | 'patientNo' | 'firstName' | 'lastName' | 'email' | 'phoneNumber'>> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.getRepository(Patient).findOne({ where: { id: patientId, isActive: true } });
      if (!patient) {
        throw new NotFoundException('Patient record not found');
      }
      const { id, patientNo, firstName, lastName, email, phoneNumber } = patient;
      return { id, patientNo, firstName, lastName, email, phoneNumber };
    });
  }

  async listAppointments(query: PaginationQueryDto = {}): Promise<PaginatedResponseDto<PatientAppointmentView>> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientActive(manager, patientId);
      const qb = manager
        .createQueryBuilder(Appointment, 'appointment')
        .select(APPOINTMENT_VIEW_COLUMNS.map((column) => `appointment.${column}`))
        .where('appointment.patientId = :patientId', { patientId })
        .orderBy('appointment.appointmentDate', 'DESC')
        .addOrderBy('appointment.appointmentTime', 'DESC');
      return paginate(qb, query);
    });
  }

  async listInvoices(query: PaginationQueryDto = {}): Promise<PaginatedResponseDto<PatientInvoiceView>> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientActive(manager, patientId);
      const qb = manager
        .createQueryBuilder(Invoice, 'invoice')
        .select(INVOICE_VIEW_COLUMNS.map((column) => `invoice.${column}`))
        .where('invoice.patientId = :patientId', { patientId })
        .orderBy('invoice.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async listPrescriptions(
    query: PaginationQueryDto = {},
  ): Promise<PaginatedResponseDto<PatientPrescriptionView>> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientActive(manager, patientId);
      const qb = manager
        .createQueryBuilder(Prescription, 'prescription')
        .select(PRESCRIPTION_VIEW_COLUMNS.map((column) => `prescription.${column}`))
        .where('prescription.patientId = :patientId', { patientId })
        .orderBy('prescription.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  /**
   * Lab and radiology results, combined. Neither LabRequisition nor RadiologyRequisition carries
   * a direct patientId — both hang off orders via orderItemId (see
   * 2026-08-23-patient-portal-design.md, Implementation Decision 5) — so this walks
   * Order -> OrderItem -> requisition. Only 'Verified' requisitions are included: an
   * in-progress or just-sampled result hasn't been clinically reviewed yet, and showing it to
   * the patient before a clinician has verified it would bypass that review.
   *
   * Pagination here is applied in-memory, after both sources are fetched and merged — the two
   * queries can't be paginated independently (page 1 needs to know both sources' combined,
   * verifiedAt-sorted order first). This bounds what's returned to the client, matching every
   * other portal endpoint's response shape, but doesn't reduce the round-trip count — that's
   * inherent to walking Order -> OrderItem -> requisition with no direct patientId on either
   * result table, a schema-level gap larger than this fix.
   */
  async listResults(query: PaginationQueryDto = {}): Promise<PaginatedResponseDto<PatientResultView>> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientActive(manager, patientId);
      const orders = await manager.getRepository(Order).find({ where: { patientId } });
      if (orders.length === 0) {
        return paginateInMemory([], query);
      }
      const orderIds = orders.map((order) => order.id);
      const orderItems = await manager
        .getRepository(OrderItem)
        .find({ where: { orderId: In(orderIds), itemType: In(['Lab', 'Radiology']) } });
      const labItemIds = orderItems.filter((item) => item.itemType === 'Lab').map((item) => item.id);
      const radiologyItemIds = orderItems
        .filter((item) => item.itemType === 'Radiology')
        .map((item) => item.id);

      const [labResults, radiologyResults] = await Promise.all([
        this.listVerifiedLabResults(manager, labItemIds),
        this.listVerifiedRadiologyResults(manager, radiologyItemIds),
      ]);
      const merged = [...labResults, ...radiologyResults].sort((a, b) => {
        const aTime = a.verifiedAt?.getTime() ?? 0;
        const bTime = b.verifiedAt?.getTime() ?? 0;
        return bTime - aTime;
      });
      return paginateInMemory(merged, query);
    });
  }

  private async listVerifiedLabResults(
    manager: EntityManager,
    orderItemIds: string[],
  ): Promise<PatientResultView[]> {
    if (orderItemIds.length === 0) {
      return [];
    }
    const requisitions = await manager
      .getRepository(LabRequisition)
      .find({ where: { orderItemId: In(orderItemIds), status: 'Verified' } });
    if (requisitions.length === 0) {
      return [];
    }
    const requisitionIds = requisitions.map((req) => req.id);
    const testIds = [...new Set(requisitions.map((req) => req.testId))];

    const [results, tests] = await Promise.all([
      manager.getRepository(LabResult).find({ where: { requisitionId: In(requisitionIds) } }),
      manager.getRepository(LabTest).find({ where: { id: In(testIds) } }),
    ]);
    const componentIds = [...new Set(results.map((result) => result.componentId))];
    const components = componentIds.length
      ? await manager.getRepository(LabTestComponent).find({ where: { id: In(componentIds) } })
      : [];

    const requisitionById = new Map(requisitions.map((req) => [req.id, req]));
    const testById = new Map(tests.map((test) => [test.id, test]));
    const componentById = new Map(components.map((component) => [component.id, component]));

    return results.map((result) => {
      const requisition = requisitionById.get(result.requisitionId);
      const test = requisition ? testById.get(requisition.testId) : undefined;
      const component = componentById.get(result.componentId);
      return {
        type: 'lab' as const,
        requisitionNumber: requisition?.requisitionNumber ?? '',
        testName: test?.name ?? 'Unknown test',
        componentName: component?.name ?? null,
        value: result.value,
        unit: component?.unit ?? null,
        isAbnormal: result.isAbnormal,
        referenceRangeText:
          component?.referenceRangeText ??
          (component?.referenceRangeLow && component?.referenceRangeHigh
            ? `${component.referenceRangeLow} - ${component.referenceRangeHigh}`
            : null),
        reportText: null,
        verifiedAt: requisition?.verifiedAt ?? null,
      };
    });
  }

  private async listVerifiedRadiologyResults(
    manager: EntityManager,
    orderItemIds: string[],
  ): Promise<PatientResultView[]> {
    if (orderItemIds.length === 0) {
      return [];
    }
    const requisitions = await manager
      .getRepository(RadiologyRequisition)
      .find({ where: { orderItemId: In(orderItemIds), status: 'Verified' } });
    if (requisitions.length === 0) {
      return [];
    }
    const imagingItemIds = [...new Set(requisitions.map((req) => req.imagingItemId))];
    const imagingItems = await manager
      .getRepository(RadiologyImagingItem)
      .find({ where: { id: In(imagingItemIds) } });
    const imagingItemById = new Map(imagingItems.map((item) => [item.id, item]));

    return requisitions.map((requisition) => ({
      type: 'radiology' as const,
      requisitionNumber: requisition.requisitionNumber,
      testName: imagingItemById.get(requisition.imagingItemId)?.name ?? 'Unknown study',
      componentName: null,
      value: null,
      unit: null,
      isAbnormal: null,
      referenceRangeText: null,
      reportText: requisition.reportText,
      verifiedAt: requisition.verifiedAt,
    }));
  }
}

/** In-memory equivalent of @hospital/pagination's paginate() for an already-fetched array — see
 *  listResults()'s doc comment for why this one can't paginate at the query level. */
function paginateInMemory<T>(items: T[], options: PaginationQueryDto): PaginatedResponseDto<T> {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    meta: {
      total: items.length,
      page,
      limit,
      totalPages: Math.ceil(items.length / limit),
    },
  };
}
