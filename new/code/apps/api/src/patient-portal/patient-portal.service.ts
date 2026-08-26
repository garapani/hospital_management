import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
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

  async listAppointments(): Promise<Appointment[]> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Appointment).find({
        where: { patientId },
        order: { appointmentDate: 'DESC', appointmentTime: 'DESC' },
      }),
    );
  }

  async listInvoices(): Promise<Invoice[]> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Invoice).find({ where: { patientId }, order: { createdAt: 'DESC' } }),
    );
  }

  async listPrescriptions(): Promise<Prescription[]> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Prescription).find({ where: { patientId }, order: { createdAt: 'DESC' } }),
    );
  }

  /**
   * Lab and radiology results, combined. Neither LabRequisition nor RadiologyRequisition carries
   * a direct patientId — both hang off orders via orderItemId (see
   * 2026-08-23-patient-portal-design.md, Implementation Decision 5) — so this walks
   * Order -> OrderItem -> requisition. Only 'Verified' requisitions are included: an
   * in-progress or just-sampled result hasn't been clinically reviewed yet, and showing it to
   * the patient before a clinician has verified it would bypass that review.
   */
  async listResults(): Promise<PatientResultView[]> {
    const patientId = this.requirePatientId();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orders = await manager.getRepository(Order).find({ where: { patientId } });
      if (orders.length === 0) {
        return [];
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
      return [...labResults, ...radiologyResults];
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
