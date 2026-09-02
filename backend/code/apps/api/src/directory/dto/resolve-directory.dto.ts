import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

// Capped at 300 — a single screen's worth of rows across every id column it might carry, not a
// bulk-export size; a caller needing more should paginate the underlying list instead.
const MAX_IDS = 300;

export class ResolveDirectoryDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  patientIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  doctorIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  wardIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  bedIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  itemIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  orderItemIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  testIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  imagingItemIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  invoiceIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  employeeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_IDS)
  @IsUUID('4', { each: true })
  departmentIds?: string[];
}
