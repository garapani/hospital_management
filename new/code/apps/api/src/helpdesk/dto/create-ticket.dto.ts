import { IsIn, IsOptional, IsString } from 'class-validator';
import type { HelpdeskTicketPriority } from '../entities/helpdesk-ticket.entity.js';

export class CreateTicketDto {
  @IsString()
  title!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsIn(['Low', 'Medium', 'High', 'Urgent'])
  priority?: HelpdeskTicketPriority;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  requesterAccountId?: string;
}
