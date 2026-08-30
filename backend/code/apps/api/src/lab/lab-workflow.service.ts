import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Logger } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrdersService } from '../orders/orders.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { LabRequisition } from './entities/lab-requisition.entity.js';
import { LabResult } from './entities/lab-result.entity.js';
import { LabTestComponent } from './entities/lab-test-component.entity.js';
import { LabTest } from './entities/lab-test.entity.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { SearchLabRequisitionsDto } from './dto/search-lab-requisitions.dto.js';
import { buildLabReportDocument } from './lab-report-document.js';

export interface CreateRequisitionInput {
  orderItemId: string;
  testId: string;
  specimenType: string;
}

export interface EnterResultInput {
  componentId: string;
  value: string;
  isAbnormal?: boolean;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  enteredBy?: string;
}

export const NON_TERMINAL_STATUSES = ['Pending', 'SampleCollected', 'ResultsEntered'];

/**
 * Evaluates a result value against its component's numeric reference range, when both are usable
 * (code-review-findings-2026-08-25 lab P2: `isAbnormal` was entirely operator-supplied — reference
 * ranges were never evaluated). Falls back to the operator-supplied value for qualitative
 * components (no numeric range — e.g. a Negative/Positive result via `referenceRangeText`) or a
 * non-numeric entered value, since the range can't govern either of those cases.
 */
function computeIsAbnormal(component: LabTestComponent, value: string, operatorSupplied?: boolean): boolean {
  if (component.referenceRangeLow != null && component.referenceRangeHigh != null) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue < Number(component.referenceRangeLow) || numericValue > Number(component.referenceRangeHigh);
    }
  }
  return operatorSupplied ?? false;
}

@Injectable()
export class LabWorkflowService {
  private readonly logger = new Logger(LabWorkflowService.name);

  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: LabRequisitionNumberGeneratorService,
    private readonly labCatalogService: LabCatalogService,
    private readonly ordersService: OrdersService,
    // domain:lab -> domain:patients: needed for renderReportPdf's patient name/phone lookup
    // (previously fetched via raw cross-domain SQL joins — see that method for the boundary-check
    // note). `eslint.config.mjs` needs a matching `boundaries/element-types` edge; the repo's
    // config-file guard hook blocks Claude from adding it, so `nx lint` will flag this import until
    // a human adds that edge (not part of CI, so this doesn't block anything today) — same
    // situation as the appointments -> patients and clinical-encounters -> patients edges added in
    // earlier passes of this same findings file.
    private readonly patientsService: PatientsService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfService: PdfService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /**
   * Actor fields (`sampleCollectedBy`, `enteredBy`, `verifiedBy`) are never trusted from the
   * caller: the authenticated principal (TenantContextService.accountId, set by
   * TenantContextMiddleware from the verified JWT) wins; the passed value is only a fallback for
   * non-HTTP callers (service specs) that run without a tenant context. `verifiedBy` is a
   * clinical sign-off, so spoofing it would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createRequisition(input: CreateRequisitionInput): Promise<LabRequisition> {
    const test = await this.labCatalogService.getTest(input.testId); // throws NotFoundException if missing
    if (!test.isActive) {
      throw new ConflictException(
        `Test ${input.testId} is deactivated; cannot create a new requisition against it`,
      );
    }
    const components = await this.labCatalogService.listComponentsByTest(input.testId);
    if (components.length === 0) {
      throw new BadRequestException(
        `Test ${input.testId} has no components defined; cannot create a requisition against it`,
      );
    }

    const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Lab') {
        throw new BadRequestException(`Order item ${input.orderItemId} is not a Lab order (itemType: ${orderItem.itemType})`);
      }
      if (orderItem.status === 'Cancelled') {
        throw new BadRequestException(`Order item ${input.orderItemId} is cancelled and cannot be requisitioned`);
      }

      const requisitionRepository = manager.getRepository(LabRequisition);
      const existing = await requisitionRepository.findOne({
        where: { orderItemId: input.orderItemId, status: Not('Cancelled') },
      });
      if (existing) {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has a non-cancelled requisition (${existing.id})`,
        );
      }

      try {
        return await requisitionRepository.save(
          requisitionRepository.create({
            orderItemId: input.orderItemId,
            testId: input.testId,
            requisitionNumber,
            specimenType: input.specimenType,
            status: 'Pending',
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_lab_requisitions_active_order_item'
        ) {
          throw new ConflictException(
            `Order item ${input.orderItemId} already has a non-cancelled requisition`,
          );
        }
        throw error;
      }
    });
  }

  async findOne(id: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(LabRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      return requisition;
    });
  }

  /**
   * Also serves as the technician worklist: `orderItemId` is optional, so `?status=Pending` (or
   * `?status=SampleCollected`) lists every requisition awaiting action across all patients, not
   * just one order item's history (code-review-findings-2026-08-25 lab P2: there was previously no
   * way to find a requisition without already knowing its order item id).
   */
  async listByOrderItem(query: SearchLabRequisitionsDto): Promise<PaginatedResponseDto<LabRequisition>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(LabRequisition).createQueryBuilder('req');
      if (query.orderItemId) {
        qb.andWhere('req.orderItemId = :orderItemId', { orderItemId: query.orderItemId });
      }
      if (query.status) {
        qb.andWhere('req.status = :status', { status: query.status });
      }
      qb.orderBy('req.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async collectSample(id: string, collectedBy?: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} must be Pending to collect a sample (current status: ${requisition.status})`,
        );
      }

      requisition.status = 'SampleCollected';
      requisition.sampleCollectedBy = this.resolveActor(collectedBy);
      requisition.sampleCollectedAt = new Date();
      return repository.save(requisition);
    });
  }

  async enterResult(requisitionId: string, input: EnterResultInput): Promise<LabResult> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisitionRepository = manager.getRepository(LabRequisition);
      const requisition = await requisitionRepository.findOne({
        where: { id: requisitionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${requisitionId} not found`);
      }
      if (requisition.status === 'Verified') {
        throw new ConflictException(`Requisition ${requisitionId} is already verified; results are locked`);
      }
      if (requisition.status === 'Cancelled') {
        throw new ConflictException(`Requisition ${requisitionId} is cancelled`);
      }
      if (requisition.status === 'Pending') {
        throw new ConflictException(
          `Requisition ${requisitionId} must have a sample collected before entering results`,
        );
      }

      const components = await manager
        .getRepository(LabTestComponent)
        .find({ where: { testId: requisition.testId }, order: { displaySequence: 'ASC' } });
      const component = components.find((c) => c.id === input.componentId);
      if (!component) {
        throw new BadRequestException(
          `Component ${input.componentId} does not belong to requisition ${requisitionId}'s test`,
        );
      }
      const isAbnormal = computeIsAbnormal(component, input.value, input.isAbnormal);

      // Uses find-then-save (not a raw INSERT ... ON CONFLICT upsert) so a result overwrite goes
      // through TypeORM's repository layer and fires AuditSubscriber's afterInsert/afterUpdate —
      // a raw-query upsert bypasses subscribers entirely, leaving no audit trail for a result
      // being silently replaced with a different value (code-review-findings-2026-08-25 P1). The
      // pessimistic_write lock on the requisition above already serializes concurrent
      // enterResult calls for the same requisition, so this find-then-save has no race window.
      const resultRepository = manager.getRepository(LabResult);
      const existingResult = await resultRepository.findOne({
        where: { requisitionId, componentId: input.componentId },
      });

      let result: LabResult;
      if (existingResult) {
        existingResult.value = input.value;
        existingResult.isAbnormal = isAbnormal;
        existingResult.enteredBy = this.resolveActor(input.enteredBy);
        existingResult.enteredAt = new Date();
        result = await resultRepository.save(existingResult);
      } else {
        result = await resultRepository.save(
          resultRepository.create({
            requisitionId,
            componentId: input.componentId,
            value: input.value,
            isAbnormal,
            enteredBy: this.resolveActor(input.enteredBy),
          }),
        );
      }

      if (requisition.status !== 'ResultsEntered') {
        const enteredResults = await manager.getRepository(LabResult).find({ where: { requisitionId } });
        const allComponentsResulted = components.every((c) =>
          enteredResults.some((r) => r.componentId === c.id),
        );
        if (allComponentsResulted) {
          requisition.status = 'ResultsEntered';
          await requisitionRepository.save(requisition);
        }
      }

      return result;
    });
  }

  /** Entered results were previously only readable via the Verified-only PDF export — a verifier
   * had no way to see what they were signing off on before that status transition. */
  async listResultsByRequisition(requisitionId: string): Promise<LabResult[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(LabRequisition).findOne({ where: { id: requisitionId } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${requisitionId} not found`);
      }
      return manager.getRepository(LabResult).find({ where: { requisitionId } });
    });
  }

  async verify(id: string, verifiedBy?: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      if (requisition.status === 'Verified') {
        throw new ConflictException(`Requisition ${id} is already verified`);
      }
      if (requisition.status === 'Cancelled') {
        throw new ConflictException(`Requisition ${id} is cancelled`);
      }
      if (requisition.status === 'Pending') {
        throw new ConflictException(`Requisition ${id} must have a sample collected before verification`);
      }

      const components = await manager
        .getRepository(LabTestComponent)
        .find({ where: { testId: requisition.testId } });
      const results = await manager.getRepository(LabResult).find({ where: { requisitionId: id } });
      const allComponentsResulted =
        components.length > 0 && components.every((c) => results.some((r) => r.componentId === c.id));
      if (!allComponentsResulted) {
        throw new ConflictException(`Requisition ${id} still has components without entered results`);
      }
      requisition.status = 'Verified';
      requisition.verifiedBy = this.resolveActor(verifiedBy);
      requisition.verifiedAt = new Date();
      const savedRequisition = await repository.save(requisition);

      // Completes the order item via OrdersService (in this same transaction) instead of
      // mutating the OrderItem repository directly. Completing the item fires
      // ChargeCaptureSubscriber (billing, Dev Standards §27), which captures a charge for the
      // patient's open invoice — best-effort: unpriced/unsupported items are skipped, never
      // rolled back.
      await this.ordersService.completeItemInTransaction(manager, savedRequisition.orderItemId, {
        completedBy: requisition.verifiedBy,
      });

      return savedRequisition;
    });
  }

  async cancel(id: string, cancelReason?: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      if (!NON_TERMINAL_STATUSES.includes(requisition.status)) {
        throw new ConflictException(
          `Requisition ${id} cannot be cancelled from status ${requisition.status}`,
        );
      }

      requisition.status = 'Cancelled';
      requisition.cancelReason = cancelReason ?? null;
      return repository.save(requisition);
    });
  }

  /** Renders a PDF of a Verified requisition's report and (best-effort) stores it in object storage. */
  async renderReportPdf(id: string): Promise<Buffer> {
    const requisition = await this.findOne(id);
    if (requisition.status !== 'Verified') {
      throw new ConflictException(`Report is only available for Verified requisitions (current: ${requisition.status})`);
    }

    // Goes through OrdersService/PatientsService (typed, module-boundary-checked calls) instead of
    // the raw cross-domain-join SQL this replaced (code-review-findings-2026-08-25 lab P3) — see
    // the constructor's boundary-edge note on `patientsService`.
    const orderItem = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(OrderItem).findOne({ where: { id: requisition.orderItemId } }),
    );
    const order = orderItem ? await this.ordersService.findOne(orderItem.orderId) : null;
    const patient = order ? await this.patientsService.findOne(order.patientId) : null;
    const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown';
    const patientPhone = patient?.phoneNumber ?? '';

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const test = await manager.getRepository(LabTest).findOne({ where: { id: requisition.testId } });
      const components = await manager.getRepository(LabTestComponent).find({
        where: { testId: requisition.testId },
        order: { displaySequence: 'ASC' },
      });
      const results = await manager.getRepository(LabResult).find({ where: { requisitionId: id } });
      const resultByComponent = new Map(results.map((r) => [r.componentId, r]));

      const buffer = await this.pdfService.render(
        buildLabReportDocument({
          patientName,
          patientPhone,
          requisitionNumber: requisition.requisitionNumber,
          testName: test?.name ?? requisition.testId,
          specimenType: requisition.specimenType,
          verifiedBy: requisition.verifiedBy ?? '',
          verifiedAt: requisition.verifiedAt?.toISOString() ?? '',
          results: components.map((component) => {
            const result = resultByComponent.get(component.id);
            return {
              componentName: component.name,
              unit: component.unit ?? null,
              value: result?.value ?? '',
              referenceRange: component.referenceRangeText ?? null,
              isAbnormal: result?.isAbnormal ?? false,
            };
          }),
        }),
      );

      const tenantId = this.tenantContext.getTenantId();
      if (tenantId) {
        try {
          await this.objectStorage.putObject(
            tenantId,
            `reports/lab/${requisition.requisitionNumber}.pdf`,
            buffer,
            buffer.length,
            { 'Content-Type': 'application/pdf' },
          );
        } catch (error) {
          this.logger.error(
            `Failed to store lab report ${requisition.requisitionNumber}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return buffer;
    });
  }
}
