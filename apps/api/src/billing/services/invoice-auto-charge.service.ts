import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { TenantConnectionService } from '../../database/tenant-connection.service';
import { OrderBillingAdapter } from '../adapters/order-billing.adapter';

@Injectable()
export class InvoiceAutoChargeService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly tenantConnection: TenantConnectionService,
    @Inject('LAB_BILLING_ADAPTER') private readonly labAdapter: OrderBillingAdapter,
    @Inject('RADIOLOGY_BILLING_ADAPTER') private readonly radiologyAdapter: OrderBillingAdapter,
    @Inject('PHARMACY_BILLING_ADAPTER') private readonly pharmacyAdapter: OrderBillingAdapter
  ) {}

  /**
   * Automatically creates or updates an invoice when a clinical order is completed.
   * This decouples the billing module from clinical modules via adapters.
   */
  async autoChargeFromOrder(orderId: string, orderType: 'Lab' | 'Radiology' | 'Pharmacy'): Promise<Invoice> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const adapter = this.getAdapter(orderType);
      
      // Use adapter to get order details without direct entity coupling
      const orderDetails = await adapter.getOrderBillingInfo(manager, orderId);
      
      if (!orderDetails) {
        throw new Error(`${orderType} order ${orderId} not found`);
      }

      // Find existing draft invoice for this patient and encounter
      let invoice = await manager.findOne(Invoice, {
        where: {
          patientId: orderDetails.patientId,
          encounterId: orderDetails.encounterId,
          status: InvoiceStatus.DRAFT
        }
      });

      if (!invoice) {
        // Create new draft invoice
        invoice = manager.create(Invoice, {
          patientId: orderDetails.patientId,
          encounterId: orderDetails.encounterId,
          status: InvoiceStatus.DRAFT,
          totalAmount: 0,
          paidAmount: 0,
          dueAmount: 0,
          items: []
        });
      }

      // Add order item to invoice
      const invoiceItem = {
        description: orderDetails.itemDescription,
        amount: orderDetails.amount,
        itemId: orderDetails.itemId,
        itemType: orderType,
        orderId: orderId
      };

      invoice.items = [...invoice.items, invoiceItem];
      invoice.totalAmount += orderDetails.amount;
      invoice.dueAmount = invoice.totalAmount - invoice.paidAmount;

      const savedInvoice = await manager.save(invoice);
      return savedInvoice;
    });
  }

  /**
   * Gets the appropriate adapter based on order type.
   */
  private getAdapter(orderType: string): OrderBillingAdapter {
    switch (orderType) {
      case 'Lab':
        return this.labAdapter;
      case 'Radiology':
        return this.radiologyAdapter;
      case 'Pharmacy':
        return this.pharmacyAdapter;
      default:
        throw new Error(`Unknown order type: ${orderType}`);
    }
  }
}
