import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min} from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { WardStockTransactionType } from '../entities/ward-stock.entity.js';

export class ReceiveStockDto {
  @IsUUID()
  departmentId!: string;

  @IsUUID()
  itemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  /** Batch lot this receipt refers to; omitted/empty = unbatchable stock ('' sentinel in the DB). */
  @IsOptional()
  @IsString()
  batchNumber?: string;

  /** ISO date; must not be in the past (already-expired stock is never a legitimate receipt). */
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  performedBy?: string;
}

export class ConsumeStockDto {
  @IsUUID()
  departmentId!: string;

  @IsUUID()
  itemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  performedBy?: string;
}

export class ReturnStockDto {
  @IsUUID()
  departmentId!: string;

  @IsUUID()
  itemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  performedBy?: string;
}

export class WasteStockDto {
  @IsUUID()
  departmentId!: string;

  @IsUUID()
  itemId!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  performedBy?: string;
}

export class AdjustStockDto {
  @IsUUID()
  departmentId!: string;

  @IsUUID()
  itemId!: string;

  /** Signed stocktake delta — positive adds stock, negative removes it; never zero. */
  @IsNumber()
  delta!: number;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  performedBy?: string;
}

export class ListBalancesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsIn(['Receive', 'Consume', 'Return', 'Adjust', 'Wastage'])
  transactionType?: WardStockTransactionType;
}
