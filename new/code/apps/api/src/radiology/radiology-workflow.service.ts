import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { RadiologyRequisition } from './entities/radiology-requisition.entity.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
import { RadiologyCatalogService } from './radiology-catalog.service.js';

export interface CreateRequisitionInput {
  orderItemId: string;
  imagingItemId: string;
}

export interface EnterReportInput {
  reportText: string;
  indication?: string;
  performerId?: string;
  reportEnteredBy: string;
}

const NON_TERMINAL_STATUSES = ['Pending', 'Scanned', 'ReportEntered'];

@Injectable()
export class RadiologyWorkflowService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: RadiologyRequisitionNumberGeneratorService,
    private readonly radiologyCatalogService: RadiologyCatalogService,
  ) {}

  async createRequisition(input: CreateRequisitionInput): Promise<RadiologyRequisition> {
    await this.radiologyCatalogService.getItem(input.imagingItemId); // throws NotFoundException if missing

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

  async findOne(id: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(RadiologyRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      return requisition;
    });
  }

  async listByOrderItem(orderItemId: string): Promise<RadiologyRequisition[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(RadiologyRequisition).find({ where: { orderItemId }, order: { createdAt: 'DESC' } }),
    );
  }

  async markScanned(id: string, scannedBy: string): Promise<RadiologyRequisition> {
    if (!scannedBy?.trim()) {
      throw new BadRequestException('scannedBy is required');
    }
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
      requisition.scannedBy = scannedBy;
      requisition.scannedAt = new Date();
      return repository.save(requisition);
    });
  }

  async enterReport(id: string, input: EnterReportInput): Promise<RadiologyRequisition> {
    if (!input.reportText?.trim()) {
      throw new BadRequestException('reportText is required');
    }
    if (!input.reportEnteredBy?.trim()) {
      throw new BadRequestException('reportEnteredBy is required');
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
      requisition.reportEnteredBy = input.reportEnteredBy;
      requisition.reportEnteredAt = new Date();
      requisition.status = 'ReportEntered';
      return repository.save(requisition);
    });
  }

  async verify(id: string, verifiedBy: string): Promise<RadiologyRequisition> {
    if (!verifiedBy?.trim()) {
      throw new BadRequestException('verifiedBy is required');
    }
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
      requisition.verifiedBy = verifiedBy;
      requisition.verifiedAt = new Date();
      return repository.save(requisition);
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
}
