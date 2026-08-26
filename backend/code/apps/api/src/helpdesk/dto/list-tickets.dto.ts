import { PaginationQueryDto } from '@hospital/pagination';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type {
  HelpdeskTicketPriority,
  HelpdeskTicketStatus,
} from '../entities/helpdesk-ticket.entity.js';

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
