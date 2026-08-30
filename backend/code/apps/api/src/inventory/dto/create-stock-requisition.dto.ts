import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested, IsUUID} from 'class-validator';

export class CreateStockRequisitionItemDto {
  @IsUUID()
  itemId!: string;

  @IsNumber()
  requestedQuantity!: number;
}

export class CreateStockRequisitionDto {
  @IsUUID()
  departmentId!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  requestedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockRequisitionItemDto)
  items!: CreateStockRequisitionItemDto[];
}
