import { PaginationQueryDto } from '@hospital/pagination';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type {
  HelpdeskTicketPriority,
  HelpdeskTicketStatus,
} from '../entities/helpdesk-ticket.entity.js';

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

export class AssignTicketDto {
  @IsString()
  assigneeAccountId!: string;
}

export class ListTicketsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['Open', 'InProgress', 'Resolved', 'Closed'])
  status?: HelpdeskTicketStatus;

  @IsOptional()
  @IsIn(['Low', 'Medium', 'High', 'Urgent'])
  priority?: HelpdeskTicketPriority;

  @IsOptional()
  @IsUUID()
  assigneeAccountId?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
