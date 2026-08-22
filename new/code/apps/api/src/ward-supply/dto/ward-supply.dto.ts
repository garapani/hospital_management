import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { WardStockTransactionType } from '../entities/ward-stock.entity.js';

export class ReceiveStockDto {
  @IsString()
  departmentId!: string;

  @IsString()
  itemId!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  departmentId!: string;

  @IsString()
  itemId!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  admissionId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  performedBy?: string;
}

export class ListBalancesQueryDto {
  @IsOptional()
  @IsString()
  departmentId?: string;
}

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @IsIn(['Receive', 'Consume'])
  transactionType?: WardStockTransactionType;
}
