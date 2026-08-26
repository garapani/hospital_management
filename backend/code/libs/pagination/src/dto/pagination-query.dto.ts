import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';

export class PaginationQueryDto {
  // No @Min/@Max here deliberately: paginate() (utils/paginate.ts) already clamps out-of-range
  // values to [1, ∞) for page and [1, 100] for limit, and every DTO extending this one inherits
  // that clamping behavior today. Adding range constraints here would turn an out-of-range value
  // from "silently clamped" into "400 rejected" for every one of those DTOs at once — a real
  // behavior change, not just whitelist-safety. @IsInt()/@Type(() => Number) only restore the
  // type coercion whitelist needs without changing what a malformed value does.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;
}
