import { PaginationQueryDto } from '@hospital/pagination';
import { WardStockTransactionType } from '../entities/ward-stock.entity.js';

export class ReceiveStockDto {
  departmentId!: string;
  itemId!: string;
  quantity!: number;
  patientId?: string;
  admissionId?: string;
  remarks?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  performedBy?: string;
}

export class ConsumeStockDto {
  departmentId!: string;
  itemId!: string;
  quantity!: number;
  patientId?: string;
  admissionId?: string;
  remarks?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  performedBy?: string;
}

export class ListBalancesQueryDto {
  departmentId?: string;
}

export class ListTransactionsQueryDto extends PaginationQueryDto {
  departmentId?: string;
  itemId?: string;
  transactionType?: WardStockTransactionType;
}
