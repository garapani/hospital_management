import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { paginate, PaginatedResponseDto, requireParam } from '@hospital/pagination';
import { SearchOrdersDto } from './dto/search-orders.dto.js';

export interface CreateOrderItemInput {
  itemType: string;
  itemDescription: string;
  priority?: string;
}

export interface CreateOrderInput {
  patientId: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  orderedBy?: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items: CreateOrderItemInput[];
}

export interface CompleteOrderItemInput {
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  completedBy?: string;
}

export interface CancelOrderItemInput {
  cancelReason?: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    // Optional only for TypeScript call sites: Nest DI always injects the @Global()
    // TenantContextService instance, and resolveActor() guards against the pre-existing manual
    // constructions in other modules' specs that predate this parameter.
    private readonly tenantContext?: TenantContextService,
  ) {}

  /**
   * Actor fields (`orderedBy`, `completedBy`) are never trusted from the caller: the authenticated
   * principal (TenantContextService.accountId, set by TenantContextMiddleware from the verified
   * JWT) wins; the passed value is only a fallback for non-HTTP callers (service specs) that run
   * without a tenant context. `completedBy` is a clinical sign-off, so spoofing it would be an
   * audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext?.getAccountId() ?? (fallback as string);
  }

  async create(input: CreateOrderInput): Promise<Order & { items: OrderItem[] }> {
    if (input.sourceAppointmentId && input.sourceAdmissionId) {
      throw new BadRequestException(
        'An order can have at most one source: sourceAppointmentId or sourceAdmissionId, not both',
      );
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('An order must include at least one item');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
      if (!patient) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      const orderRepository = manager.getRepository(Order);
      const order = await orderRepository.save(
        orderRepository.create({
          patientId: input.patientId,
          orderedBy: this.resolveActor(input.orderedBy),
          sourceAppointmentId: input.sourceAppointmentId ?? null,
          sourceAdmissionId: input.sourceAdmissionId ?? null,
          notes: input.notes ?? null,
        }),
      );

      const itemRepository = manager.getRepository(OrderItem);
      const items = await itemRepository.save(
        input.items.map((item) =>
          itemRepository.create({
            orderId: order.id,
            itemType: item.itemType,
            itemDescription: item.itemDescription,
            priority: item.priority ?? 'Routine',
            status: 'Pending',
          }),
        ),
      );

      return { ...order, items };
    });
  }

  async findOne(id: string): Promise<Order & { items: OrderItem[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const order = await manager.getRepository(Order).findOne({ where: { id } });
      if (!order) {
        throw new NotFoundException(`Order ${id} not found`);
      }
      const items = await manager.getRepository(OrderItem).find({
        where: { orderId: id },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      return { ...order, items };
    });
  }

  async list(query: SearchOrdersDto): Promise<PaginatedResponseDto<Order>> {
    const patientId = requireParam(query.patientId, 'patientId');
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(Order).createQueryBuilder('order');
      qb.where('order.patientId = :patientId', { patientId });
      qb.orderBy('order.orderedAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async completeItem(orderId: string, itemId: string, input: CompleteOrderItemInput): Promise<OrderItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(OrderItem);
      const item = await repository.findOne({ where: { id: itemId, orderId } });
      if (!item) {
        throw new NotFoundException(`Order item ${itemId} not found in order ${orderId}`);
      }
      if (item.status !== 'Pending') {
        throw new ConflictException(`Order item ${itemId} is already ${item.status.toLowerCase()}`);
      }

      item.status = 'Completed';
      item.completedBy = this.resolveActor(input.completedBy);
      item.completedAt = new Date();
      return repository.save(item);
    });
  }

  /**
   * Marks an order item Completed using a caller-supplied manager, so the workflow services that
   * finish a Lab/Radiology/Pharmacy order item can complete it in the same transaction as their
   * own status transition, instead of reaching into the OrderItem repository directly. Idempotent
   * (a no-op returning the existing row) if the item doesn't exist or is already Completed —
   * matches the tolerant check every caller of this used to inline itself.
   */
  async completeItemInTransaction(
    manager: EntityManager,
    itemId: string,
    input: CompleteOrderItemInput,
  ): Promise<OrderItem | null> {
    const repository = manager.getRepository(OrderItem);
    const item = await repository.findOne({ where: { id: itemId } });
    if (!item || item.status === 'Completed') {
      return item;
    }

    item.status = 'Completed';
    item.completedBy = this.resolveActor(input.completedBy);
    item.completedAt = new Date();
    return repository.save(item);
  }

  async cancelItem(orderId: string, itemId: string, input: CancelOrderItemInput): Promise<OrderItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(OrderItem);
      const item = await repository.findOne({ where: { id: itemId, orderId } });
      if (!item) {
        throw new NotFoundException(`Order item ${itemId} not found in order ${orderId}`);
      }
      if (item.status !== 'Pending') {
        throw new ConflictException(`Order item ${itemId} is already ${item.status.toLowerCase()}`);
      }

      item.status = 'Cancelled';
      item.cancelReason = input.cancelReason ?? null;
      return repository.save(item);
    });
  }
}
