import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrdersService } from '../orders/orders.service.js';
import { LabRequisition } from './entities/lab-requisition.entity.js';
import { LabResult } from './entities/lab-result.entity.js';
import { LabTestComponent } from './entities/lab-test-component.entity.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { LabCatalogService } from './lab-catalog.service.js';
import { paginate, PaginatedResponseDto, requireParam } from '@hospital/pagination';
import { SearchLabRequisitionsDto } from './dto/search-lab-requisitions.dto.js';

export interface CreateRequisitionInput {
  orderItemId: string;
  testId: string;
  specimenType: string;
}

export interface EnterResultInput {
  componentId: string;
  value: string;
  isAbnormal?: boolean;
  enteredBy: string;
}

const NON_TERMINAL_STATUSES = ['Pending', 'SampleCollected', 'ResultsEntered'];

@Injectable()
export class LabWorkflowService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: LabRequisitionNumberGeneratorService,
    private readonly labCatalogService: LabCatalogService,
    private readonly ordersService: OrdersService,
  ) {}

  async createRequisition(input: CreateRequisitionInput): Promise<LabRequisition> {
    await this.labCatalogService.getTest(input.testId); // throws NotFoundException if missing
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
        if (error instanceof QueryFailedError && (error as QueryFailedError & { code?: string }).code === '23505') {
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

  async listByOrderItem(query: SearchLabRequisitionsDto): Promise<PaginatedResponseDto<LabRequisition>> {
    const orderItemId = requireParam(query.orderItemId, 'orderItemId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(LabRequisition).createQueryBuilder('req');
      qb.where('req.orderItemId = :orderItemId', { orderItemId });
      qb.orderBy('req.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async collectSample(id: string, collectedBy: string): Promise<LabRequisition> {
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
      requisition.sampleCollectedBy = collectedBy;
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
      if (!components.some((c) => c.id === input.componentId)) {
        throw new BadRequestException(
          `Component ${input.componentId} does not belong to requisition ${requisitionId}'s test`,
        );
      }

      const result = await manager.query(
        `
        INSERT INTO lab_results ("requisitionId", "componentId", value, "isAbnormal", "enteredBy")
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("requisitionId", "componentId")
        DO UPDATE SET value = $3, "isAbnormal" = $4, "enteredBy" = $5, "enteredAt" = now()
        RETURNING *
        `,
        [requisitionId, input.componentId, input.value, input.isAbnormal ?? false, input.enteredBy],
      );

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

      return result[0] as LabResult;
    });
  }

  async verify(id: string, verifiedBy: string): Promise<LabRequisition> {
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
      requisition.verifiedBy = verifiedBy;
      requisition.verifiedAt = new Date();
      const savedRequisition = await repository.save(requisition);

      // Completes the order item via OrdersService (in this same transaction) instead of
      // mutating the OrderItem repository directly. Billing charge-capture is not wired to
      // this event yet — see pending-tasks.md.
      await this.ordersService.completeItemInTransaction(manager, savedRequisition.orderItemId, {
        completedBy: verifiedBy,
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
}
