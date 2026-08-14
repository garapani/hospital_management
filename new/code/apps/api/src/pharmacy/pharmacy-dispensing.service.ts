import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { OrdersService } from '../orders/orders.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { PharmacyDispensing } from './entities/pharmacy-dispensing.entity.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';
import { FefoStockDecrementService } from '../inventory/fefo-stock-decrement.service.js';
import { ListPharmacyDispensingDto } from './dto/list-pharmacy-dispensing.dto.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';

export interface CreateDispensingInput {
  orderItemId: string;
  inventoryItemId: string;
  quantity: number;
}

export interface DispenseDrugInput {
  dispensedBy: string;
}

@Injectable()
export class PharmacyDispensingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dispensingNumberGenerator: PharmacyDispensingNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly ordersService: OrdersService,
    private readonly fefoStockDecrement: FefoStockDecrementService,
  ) {}

  async createDispensing(input: CreateDispensingInput): Promise<PharmacyDispensing> {
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    await this.inventoryCatalogService.getItem(input.inventoryItemId); // throws NotFoundException if missing

    const dispensingNumber = await this.dispensingNumberGenerator.generateNextDispensingNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Pharmacy') {
        throw new BadRequestException(
          `Order item ${input.orderItemId} is not a Pharmacy order (itemType: ${orderItem.itemType})`,
        );
      }
      if (orderItem.status === 'Cancelled') {
        throw new BadRequestException(`Order item ${input.orderItemId} is cancelled and cannot be dispensed`);
      }

      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const existing = await dispensingRepository.findOne({
        where: { orderItemId: input.orderItemId, status: Not('Cancelled') },
      });
      if (existing) {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has a non-cancelled dispensing (${existing.id})`,
        );
      }

      try {
        return await dispensingRepository.save(
          dispensingRepository.create({
            orderItemId: input.orderItemId,
            inventoryItemId: input.inventoryItemId,
            dispensingNumber,
            quantity: String(quantity),
            status: 'Pending',
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_pharmacy_dispensings_active_order_item'
        ) {
          throw new ConflictException(`Order item ${input.orderItemId} already has a non-cancelled dispensing`);
        }
        throw error;
      }
    });
  }

  async findOne(id: string): Promise<PharmacyDispensing> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensing = await manager.getRepository(PharmacyDispensing).findOne({ where: { id } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      return dispensing;
    });
  }

  async listByOrderItem(orderItemId: string): Promise<PharmacyDispensing[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(PharmacyDispensing).find({ where: { orderItemId }, order: { createdAt: 'DESC' } }),
    );
  }

  async findAll(query: ListPharmacyDispensingDto): Promise<PaginatedResponseDto<PharmacyDispensing>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(PharmacyDispensing).createQueryBuilder('dispensing')
        .leftJoinAndSelect('dispensing.orderItem', 'orderItem')
        .orderBy('dispensing.createdAt', 'DESC');

      if (query.orderItemId) {
        qb.andWhere('dispensing.orderItemId = :orderItemId', { orderItemId: query.orderItemId });
      }

      if (query.status) {
        qb.andWhere('dispensing.status = :status', { status: query.status });
      }

      return paginate(qb, { page: query.page, limit: query.limit });
    });
  }

  async cancel(id: string, cancelReason?: string): Promise<PharmacyDispensing> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PharmacyDispensing);
      const dispensing = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      if (dispensing.status !== 'Pending') {
        throw new ConflictException(
          `Dispensing ${id} can only be cancelled while status is Pending (current: ${dispensing.status})`,
        );
      }

      dispensing.status = 'Cancelled';
      dispensing.cancelReason = cancelReason ?? null;
      return repository.save(dispensing);
    });
  }

  async dispenseDrug(id: string, input: DispenseDrugInput): Promise<PharmacyDispensing> {
    if (!input.dispensedBy?.trim()) {
      throw new BadRequestException('dispensedBy is required');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const dispensing = await dispensingRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      if (dispensing.status !== 'Pending') {
        throw new ConflictException(
          `Dispensing ${id} must be Pending to dispense (current status: ${dispensing.status})`,
        );
      }

      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: dispensing.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${dispensing.orderItemId} not found`);
      }
      if (orderItem.status === 'Cancelled') {
        throw new ConflictException(
          `Order item ${dispensing.orderItemId} was cancelled after this dispensing was created; cannot dispense`,
        );
      }

      const quantity = Number(dispensing.quantity);

      await this.fefoStockDecrement.decrementInTransaction(manager, {
        itemId: dispensing.inventoryItemId,
        quantity,
        transactionType: 'PharmacyDispense',
        referenceId: dispensing.id,
        recordedBy: input.dispensedBy,
      });

      dispensing.status = 'Dispensed';
      dispensing.dispensedBy = input.dispensedBy;
      dispensing.dispensedAt = new Date();
      const savedDispensing = await dispensingRepository.save(dispensing);

      // Completes the order item via OrdersService (in this same transaction) instead of
      // mutating the OrderItem repository directly. Billing charge-capture is not wired to
      // this event yet — see pending-tasks.md.
      await this.ordersService.completeItemInTransaction(manager, orderItem.id, {
        completedBy: input.dispensedBy,
      });

      return savedDispensing;
    });
  }
}
