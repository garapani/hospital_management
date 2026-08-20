import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { MasterDataService } from '../master-data/master-data.service.js';
import { StockRequisition } from './entities/stock-requisition.entity.js';
import { StockRequisitionItem } from './entities/stock-requisition-item.entity.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { FefoStockDecrementService } from './fefo-stock-decrement.service.js';
import { paginate, PaginatedResponseDto, requireParam } from '@hospital/pagination';
import { SearchStockRequisitionsDto } from './dto/search-stock-requisitions.dto.js';

export interface CreateRequisitionItemInput {
  itemId: string;
  requestedQuantity: number;
}

export interface CreateRequisitionInput {
  departmentId: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  requestedBy?: string;
  notes?: string;
  items: CreateRequisitionItemInput[];
}

const NON_TERMINAL_REQUISITION_STATUSES = ['Pending', 'PartiallyFulfilled'];

export interface FulfillRequisitionItemInput {
  quantity: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  fulfilledBy?: string;
}

@Injectable()
export class InventoryRequisitionService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: StockRequisitionNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly masterDataService: MasterDataService,
    private readonly fefoStockDecrement: FefoStockDecrementService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`requestedBy`, `fulfilledBy`) are never trusted from the caller: the
   * authenticated principal (TenantContextService.accountId, set by TenantContextMiddleware from
   * the verified JWT) wins; the passed value is only a fallback for non-HTTP callers (service
   * specs) that run without a tenant context. These fields are audit-trail integrity markers, so
   * spoofing them would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createRequisition(
    input: CreateRequisitionInput,
  ): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    const requestedBy = this.resolveActor(input.requestedBy);
    if (!requestedBy?.trim()) {
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
          requestedBy,
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

  async listByDepartment(query: SearchStockRequisitionsDto): Promise<PaginatedResponseDto<StockRequisition>> {
    const departmentId = requireParam(query.departmentId, 'departmentId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(StockRequisition).createQueryBuilder('req');
      qb.where('req.departmentId = :departmentId', { departmentId });
      qb.orderBy('req.createdAt', 'DESC');
      return paginate(qb, query);
    });
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

  async fulfillRequisitionItem(
    stockRequisitionItemId: string,
    input: FulfillRequisitionItemInput,
  ): Promise<StockRequisitionItem> {
    const fulfilledBy = this.resolveActor(input.fulfilledBy);
    if (!fulfilledBy?.trim()) {
      throw new BadRequestException('fulfilledBy is required');
    }
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const reqItemRepository = manager.getRepository(StockRequisitionItem);
      const reqItem = await reqItemRepository.findOne({
        where: { id: stockRequisitionItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reqItem) {
        throw new NotFoundException(`Stock requisition item ${stockRequisitionItemId} not found`);
      }

      const requisitionRepository = manager.getRepository(StockRequisition);
      const requisition = await requisitionRepository.findOne({
        where: { id: reqItem.requisitionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${reqItem.requisitionId} not found`);
      }
      if (!NON_TERMINAL_REQUISITION_STATUSES.includes(requisition.status)) {
        throw new ConflictException(
          `Requisition ${requisition.id} cannot be fulfilled from status ${requisition.status}`,
        );
      }

      const newFulfilledQuantity = Number(reqItem.fulfilledQuantity) + quantity;
      if (newFulfilledQuantity > Number(reqItem.requestedQuantity)) {
        throw new BadRequestException(
          `Fulfilling ${quantity} would exceed the requested quantity for line ${stockRequisitionItemId} ` +
            `(requested: ${reqItem.requestedQuantity}, already fulfilled: ${reqItem.fulfilledQuantity})`,
        );
      }

      await this.fefoStockDecrement.decrementInTransaction(manager, {
        itemId: reqItem.itemId,
        quantity,
        transactionType: 'Dispatch',
        referenceId: reqItem.id,
        recordedBy: fulfilledBy,
      });

      reqItem.fulfilledQuantity = String(newFulfilledQuantity);
      const savedReqItem = await reqItemRepository.save(reqItem);

      const siblingItems = await reqItemRepository.find({ where: { requisitionId: requisition.id } });
      const fullyFulfilled = siblingItems.every(
        (line) => Number(line.fulfilledQuantity) >= Number(line.requestedQuantity),
      );
      requisition.status = fullyFulfilled ? 'Fulfilled' : 'PartiallyFulfilled';
      await requisitionRepository.save(requisition);

      return savedReqItem;
    });
  }
}
