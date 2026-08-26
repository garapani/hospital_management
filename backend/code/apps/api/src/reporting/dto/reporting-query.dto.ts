import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

/** Shared date-range filters — previously raw @Query strings passed straight into SQL
 *  (code-review-findings-2026-08-25 reporting P3). */
export class DateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListEventsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
