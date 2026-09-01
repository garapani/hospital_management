import { IsOptional, IsUUID } from 'class-validator';

/** wardId omitted or null clears the assignment (tenant-wide access); a uuid assigns it. */
export class SetWardDto {
  @IsOptional()
  @IsUUID()
  wardId?: string | null;
}
