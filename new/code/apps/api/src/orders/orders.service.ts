import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';

export interface CreateOrderItemInput {
  itemType: string;
  itemDescription: string;
  priority?: string;
}

export interface CreateOrderInput {
  patientId: string;
  orderedBy: string;
  sourceAppointmentId?: string;
  sourceAdmissionId?: string;
  notes?: string;
  items: CreateOrderItemInput[];
}

export interface CompleteOrderItemInput {
  completedBy: string;
}

export interface CancelOrderItemInput {
  cancelReason?: string;
}

@Injectable()
export class OrdersService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

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
          orderedBy: input.orderedBy,
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
        order: { createdAt: 'ASC' },
      });
      return { ...order, items };
    });
  }

  async list(patientId?: string): Promise<Order[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Order).find({
        where: patientId ? { patientId } : {},
        order: { orderedAt: 'DESC' },
      }),
    );
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
      item.completedBy = input.completedBy;
      item.completedAt = new Date();
      return repository.save(item);
    });
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
