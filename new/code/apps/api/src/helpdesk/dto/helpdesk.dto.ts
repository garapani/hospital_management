import { PaginationQueryDto } from '@hospital/pagination';
import {
  HelpdeskTicketPriority,
  HelpdeskTicketStatus,
} from '../entities/helpdesk-ticket.entity.js';

export class CreateTicketDto {
  title!: string;
  description!: string;
  category?: string;
  priority?: HelpdeskTicketPriority;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  requesterAccountId?: string;
}

export class AssignTicketDto {
  assigneeAccountId!: string;
}

export class ListTicketsQueryDto extends PaginationQueryDto {
  status?: HelpdeskTicketStatus;
  priority?: HelpdeskTicketPriority;
  assigneeAccountId?: string;
  q?: string;
}
