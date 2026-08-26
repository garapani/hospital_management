import { PaginationQueryDto } from '@hospital/pagination';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { SterilizationCycleStatus } from '../entities/cssd.entity.js';

// Was previously bound in the controller as `PaginationQueryDto & ListCyclesQueryDto` — an
// intersection of two classes has no single runtime constructor, so Nest couldn't resolve a
// metatype for it and skipped validation entirely regardless of `whitelist` (see 2.14 Phase B /
// claude-code-tasks.md 2.18). Extending directly fixes that.
export class ListCyclesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  instrumentId?: string;

  @IsOptional()
  @IsIn(['InProgress', 'Completed', 'Failed'])
  status?: SterilizationCycleStatus;
}
