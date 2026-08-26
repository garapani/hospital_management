import { PaginationQueryDto } from '@hospital/pagination';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { OtSurgeryStatus } from '../entities/ot-surgery.entity.js';

// Extends PaginationQueryDto (not hand-rolled @IsNumber() page/limit) so page/limit stay @IsInt(),
// matching every other list DTO in the app — a non-integer limit would otherwise reach
// paginate()'s .skip()/.take() as a float, which Postgres rejects with a 500 instead of the
// clean 400 every sibling endpoint returns for the same malformed input.
export class ListSurgeriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['Scheduled', 'InProgress', 'Completed', 'Cancelled'])
  status?: OtSurgeryStatus;

  @IsOptional()
  @IsUUID()
  patientId?: string;
}
