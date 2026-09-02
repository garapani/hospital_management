import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrdersService } from '../orders/orders.service.js';
import { RadiologyRequisition } from './entities/radiology-requisition.entity.js';
import { RadiologyImagingItem } from './entities/radiology-imaging-item.entity.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { ListRadiologyRequisitionDto } from './dto/list-radiology-requisition.dto.js';
import { buildRadiologyReportDocument } from './radiology-report-document.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';

export interface CreateRequisitionInput {
  orderItemId: string;
  imagingItemId: string;
}

export interface EnterReportInput {
  reportText: string;
  indication?: string;
  performerId?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  reportEnteredBy?: string;
}

export const NON_TERMINAL_STATUSES = ['Pending', 'Scanned', 'ReportEntered'];

@Injectable()
export class RadiologyWorkflowService {
  private readonly logger = new Logger(RadiologyWorkflowService.name);

  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: RadiologyRequisitionNumberGeneratorService,
    private readonly radiologyCatalogService: RadiologyCatalogService,
    private readonly ordersService: OrdersService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfService: PdfService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  /**
   * Actor fields (`scannedBy`, `reportEnteredBy`, `verifiedBy`) are never trusted from the
   * caller: the authenticated principal (TenantContextService.accountId, set by
   * TenantContextMiddleware from the verified JWT) wins; the passed value is only a fallback for
   * non-HTTP callers (service specs) that run without a tenant context. `verifiedBy` is a
   * clinical sign-off, so spoofing it would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createRequisition(input: CreateRequisitionInput): Promise<RadiologyRequisition> {
    const item = await this.radiologyCatalogService.getItem(input.imagingItemId); // throws NotFoundException if missing
    if (!item.isActive) {
      throw new ConflictException(
        `Radiology imaging item ${input.imagingItemId} is deactivated; cannot create a new requisition against it`,
      );
    }

    const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Radiology') {
        throw new BadRequestException(
          `Order item ${input.orderItemId} is not a Radiology order (itemType: ${orderItem.itemType})`,
        );
      }
      if (orderItem.status === 'Cancelled') {
        throw new BadRequestException(`Order item ${input.orderItemId} is cancelled and cannot be requisitioned`);
      }

      const requisitionRepository = manager.getRepository(RadiologyRequisition);
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
            imagingItemId: input.imagingItemId,
            requisitionNumber,
            status: 'Pending',
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_radiology_requisitions_active_order_item'
        ) {
          throw new ConflictException(`Order item ${input.orderItemId} already has a non-cancelled requisition`);
        }
        throw error;
      }
    });
  }

  async findOne(id: string): Promise<RadiologyRequisition & { patientId: string | null }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(RadiologyRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      // Same join shape as renderReportPdf below — patientId was previously fetched only for the
      // PDF path and never exposed via the JSON API a Radiology Technician's worklist actually
      // uses, so there was no on-screen confirmation of whose scan a Verify sign-off applied to
      // (found live during the 2026-09-02 role-based review).
      const orderRows = await manager.query(
        `SELECT o."patientId" FROM orders o JOIN order_items oi ON oi."orderId" = o.id WHERE oi.id = $1`,
        [requisition.orderItemId],
      );
      return { ...requisition, patientId: orderRows[0]?.patientId ?? null };
    });
  }

  async findAll(
    query: ListRadiologyRequisitionDto,
  ): Promise<PaginatedResponseDto<RadiologyRequisition & { patientId: string | null }>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(RadiologyRequisition).createQueryBuilder('requisition')
        .leftJoinAndSelect('requisition.orderItem', 'orderItem')
        .orderBy('requisition.createdAt', 'DESC');

      if (query.orderItemId) {
        qb.andWhere('requisition.orderItemId = :orderItemId', { orderItemId: query.orderItemId });
      }

      if (query.status) {
        qb.andWhere('requisition.status = :status', { status: query.status });
      }

      if (query.imagingItemId) {
        qb.andWhere('requisition.imagingItemId = :imagingItemId', { imagingItemId: query.imagingItemId });
      }

      const result = await paginate(qb, { page: query.page, limit: query.limit });
      if (result.data.length === 0) {
        return { ...result, data: [] };
      }
      // One bulk lookup for the whole page rather than one query per row — same ANY($1) shape
      // directory.service.ts's bulk resolver already uses for this exact class of problem.
      const orderRows: Array<{ orderItemId: string; patientId: string }> = await manager.query(
        `SELECT oi.id AS "orderItemId", o."patientId" AS "patientId"
         FROM order_items oi JOIN orders o ON o.id = oi."orderId"
         WHERE oi.id = ANY($1)`,
        [result.data.map((r) => r.orderItemId)],
      );
      const patientIdByOrderItem = new Map(orderRows.map((r) => [r.orderItemId, r.patientId]));
      return {
        ...result,
        data: result.data.map((r) => ({ ...r, patientId: patientIdByOrderItem.get(r.orderItemId) ?? null })),
      };
    });
  }

  async markScanned(id: string, scannedBy?: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} must be Pending to mark scanned (current status: ${requisition.status})`,
        );
      }

      requisition.status = 'Scanned';
      requisition.scannedBy = this.resolveActor(scannedBy);
      requisition.scannedAt = new Date();
      return repository.save(requisition);
    });
  }

  async enterReport(id: string, input: EnterReportInput): Promise<RadiologyRequisition> {
    if (!input.reportText?.trim()) {
      throw new BadRequestException('reportText is required');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (requisition.status === 'Verified') {
        throw new ConflictException(`Requisition ${id} is already verified; the report is locked`);
      }
      if (requisition.status === 'Cancelled') {
        throw new ConflictException(`Requisition ${id} is cancelled`);
      }
      if (requisition.status === 'Pending') {
        throw new ConflictException(`Requisition ${id} must be scanned before entering a report`);
      }

      requisition.reportText = input.reportText;
      requisition.indication = input.indication ?? null;
      requisition.performerId = input.performerId ?? null;
      requisition.reportEnteredBy = this.resolveActor(input.reportEnteredBy);
      requisition.reportEnteredAt = new Date();
      requisition.status = 'ReportEntered';
      return repository.save(requisition);
    });
  }

  async verify(id: string, verifiedBy?: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (requisition.status !== 'ReportEntered') {
        throw new ConflictException(
          `Requisition ${id} must have a report entered before verification (current status: ${requisition.status})`,
        );
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

  async cancel(id: string, cancelReason?: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (!NON_TERMINAL_STATUSES.includes(requisition.status)) {
        throw new ConflictException(`Requisition ${id} cannot be cancelled from status ${requisition.status}`);
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
      throw new ConflictException(
        `Report is only available for Verified requisitions (current: ${requisition.status})`,
      );
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const imagingItem = await manager
        .getRepository(RadiologyImagingItem)
        .findOne({ where: { id: requisition.imagingItemId } });

      const orderRows = await manager.query(
        `SELECT o."patientId" FROM orders o JOIN order_items oi ON oi."orderId" = o.id WHERE oi.id = $1`,
        [requisition.orderItemId],
      );
      const patient = orderRows.length > 0
        ? await manager.query(`SELECT "firstName", "lastName", "phoneNumber" FROM patients WHERE id = $1`, [orderRows[0].patientId])
        : [];
      const patientName = patient.length > 0 ? `${patient[0].firstName} ${patient[0].lastName}` : 'Unknown';

      const buffer = await this.pdfService.render(
        buildRadiologyReportDocument({
          patientName,
          patientPhone: patient[0]?.phoneNumber ?? '',
          requisitionNumber: requisition.requisitionNumber,
          imagingItemName: imagingItem?.name ?? requisition.imagingItemId,
          procedureCode: imagingItem?.procedureCode ?? null,
          indication: requisition.indication,
          reportText: requisition.reportText ?? '',
          verifiedBy: requisition.verifiedBy ?? '',
          verifiedAt: requisition.verifiedAt?.toISOString() ?? '',
        }),
      );

      const tenantId = this.tenantContext.getTenantId();
      if (tenantId) {
        try {
          await this.objectStorage.putObject(
            tenantId,
            `reports/radiology/${requisition.requisitionNumber}.pdf`,
            buffer,
            buffer.length,
            { 'Content-Type': 'application/pdf' },
          );
        } catch (error) {
          this.logger.error(
            `Failed to store radiology report ${requisition.requisitionNumber}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return buffer;
    });
  }
}
