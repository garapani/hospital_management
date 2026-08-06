import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { StockRequisition } from './entities/stock-requisition.entity.js';
import { StockRequisitionItem } from './entities/stock-requisition-item.entity.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';

export interface CreateRequisitionItemInput {
  itemId: string;
  requestedQuantity: number;
}

export interface CreateRequisitionInput {
  departmentId: string;
  requestedBy: string;
  notes?: string;
  items: CreateRequisitionItemInput[];
}

@Injectable()
export class InventoryRequisitionService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: StockRequisitionNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly masterDataService: MasterDataService,
  ) {}

  async createRequisition(
    input: CreateRequisitionInput,
  ): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    if (!input.requestedBy?.trim()) {
      throw new BadRequestException('requestedBy is required');
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('A requisition must include at least one item');
    }

    const validatedItems: Array<{ itemId: string; requestedQuantity: number }> = [];
    for (const line of input.items) {
      const requestedQuantity = Number(line.requestedQuantity);
      if (
        typeof line.requestedQuantity !== 'number' ||
        !Number.isFinite(requestedQuantity) ||
        requestedQuantity <= 0
      ) {
        throw new BadRequestException(`Item ${line.itemId} must have a positive requestedQuantity`);
      }
      validatedItems.push({ itemId: line.itemId, requestedQuantity });
    }

    const department = await this.masterDataService.getDepartment(input.departmentId);
    if (!department) {
      throw new NotFoundException(`Department ${input.departmentId} not found`);
    }
    // Single batched existence check instead of one getItem call (and transaction) per line.
    await this.inventoryCatalogService.getItemsByIds(validatedItems.map((line) => line.itemId));

    const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisitionRepository = manager.getRepository(StockRequisition);
      const requisition = await requisitionRepository.save(
        requisitionRepository.create({
          departmentId: input.departmentId,
          requestedBy: input.requestedBy,
          requisitionNumber,
          notes: input.notes ?? null,
          status: 'Pending',
        }),
      );

      const itemRepository = manager.getRepository(StockRequisitionItem);
      const items = await itemRepository.save(
        validatedItems.map((line) => {
          const itemData: Partial<StockRequisitionItem> = {
            requisitionId: requisition.id,
            itemId: line.itemId,
            requestedQuantity: String(line.requestedQuantity),
          };
          return itemRepository.create(itemData);
        }),
      );

      return { ...requisition, items };
    });
  }

  async findOne(id: string): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(StockRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${id} not found`);
      }
      const items = await manager
        .getRepository(StockRequisitionItem)
        .find({ where: { requisitionId: id }, order: { createdAt: 'ASC' } });
      return { ...requisition, items };
    });
  }

  async listByDepartment(departmentId: string): Promise<StockRequisition[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(StockRequisition).find({ where: { departmentId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancel(id: string, cancelReason?: string): Promise<StockRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(StockRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} can only be cancelled while status is Pending (current: ${requisition.status})`,
        );
      }

      requisition.status = 'Cancelled';
      requisition.cancelReason = cancelReason ?? null;
      return repository.save(requisition);
    });
  }
}
