import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import {
  HelpdeskTicket,
  HelpdeskTicketPriority,
} from './entities/helpdesk-ticket.entity.js';
import { HelpdeskTicketNumberGeneratorService } from './helpdesk-ticket-number-generator.service.js';

export interface CreateTicketInput {
  title: string;
  description: string;
  category?: string;
  priority?: HelpdeskTicketPriority;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  requesterAccountId?: string;
}

export interface ListTicketsQuery extends PaginationQueryDto {
  status?: string;
  priority?: HelpdeskTicketPriority;
  assigneeAccountId?: string;
  q?: string;
}

const PRIORITIES: HelpdeskTicketPriority[] = ['Low', 'Medium', 'High', 'Urgent'];

export type HelpdeskTicketWithNames = HelpdeskTicket & {
  requesterName: string | null;
  assigneeName: string | null;
};

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly ticketNumberGenerator: HelpdeskTicketNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`requesterAccountId`, `resolvedBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, so the audit trail of who raised/resolved a ticket can never be spoofed.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createTicket(input: CreateTicketInput): Promise<HelpdeskTicket> {
    if (!input.title?.trim()) {
      throw new BadRequestException('title is required');
    }
    if (!input.description?.trim()) {
      throw new BadRequestException('description is required');
    }
    if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) {
      throw new BadRequestException(`priority must be one of: ${PRIORITIES.join(', ')}`);
    }
    const ticketNumber = await this.ticketNumberGenerator.generateNextTicketNumber();
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(HelpdeskTicket).save(
        manager.getRepository(HelpdeskTicket).create({
          ticketNumber,
          title: input.title.trim(),
          description: input.description.trim(),
          category: input.category?.trim() || null,
          priority: input.priority ?? 'Medium',
          status: 'Open',
          requesterAccountId: this.resolveActor(input.requesterAccountId),
          assigneeAccountId: null,
          resolvedBy: null,
          resolvedAt: null,
          closedAt: null,
        }),
      ),
    );
  }

  /** Assign any non-terminal ticket (Open/InProgress); Resolved/Closed tickets are locked. */
  async assignTicket(id: string, assigneeAccountId: string, actor?: string): Promise<HelpdeskTicket> {
    if (!assigneeAccountId?.trim()) {
      throw new BadRequestException('assigneeAccountId is required');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // The assignee must be a real, active staff account — assigning to a bogus id would
      // silently hand the ticket to nobody (code-review-findings-2026-08-25 helpdesk P3; raw
      // lookup, no cross-module import).
      const assignee = await manager.query(
        `SELECT id, "isActive" FROM accounts WHERE id = $1`,
        [assigneeAccountId],
      );
      if (assignee.length === 0) {
        throw new NotFoundException(`Account ${assigneeAccountId} not found`);
      }
      if (!assignee[0].isActive) {
        throw new ConflictException(`Account ${assigneeAccountId} is deactivated and cannot be assigned`);
      }

      const repository = manager.getRepository(HelpdeskTicket);
      const ticket = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) {
        throw new NotFoundException(`Helpdesk ticket ${id} not found`);
      }
      if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
        throw new ConflictException(
          `Helpdesk ticket ${id} cannot move from ${ticket.status} to assigned`,
        );
      }
      ticket.assigneeAccountId = assigneeAccountId;
      return repository.save(ticket);
    });
  }

  async startTicket(id: string, actor?: string): Promise<HelpdeskTicket> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(HelpdeskTicket);
      const ticket = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) {
        throw new NotFoundException(`Helpdesk ticket ${id} not found`);
      }
      if (ticket.status !== 'Open') {
        throw new ConflictException(
          `Helpdesk ticket ${id} cannot move from ${ticket.status} to InProgress`,
        );
      }
      ticket.status = 'InProgress';
      return repository.save(ticket);
    });
  }

  async resolveTicket(id: string, actor?: string): Promise<HelpdeskTicket> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(HelpdeskTicket);
      const ticket = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) {
        throw new NotFoundException(`Helpdesk ticket ${id} not found`);
      }
      if (ticket.status !== 'Open' && ticket.status !== 'InProgress') {
        throw new ConflictException(
          `Helpdesk ticket ${id} cannot move from ${ticket.status} to Resolved`,
        );
      }
      ticket.status = 'Resolved';
      ticket.resolvedBy = this.resolveActor(actor);
      ticket.resolvedAt = new Date();
      return repository.save(ticket);
    });
  }

  async closeTicket(id: string, actor?: string): Promise<HelpdeskTicket> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(HelpdeskTicket);
      const ticket = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ticket) {
        throw new NotFoundException(`Helpdesk ticket ${id} not found`);
      }
      if (ticket.status !== 'Resolved') {
        throw new ConflictException(
          `Helpdesk ticket ${id} cannot move from ${ticket.status} to Closed`,
        );
      }
      ticket.status = 'Closed';
      ticket.closedAt = new Date();
      return repository.save(ticket);
    });
  }

  async listTickets(query: ListTicketsQuery = {}): Promise<PaginatedResponseDto<HelpdeskTicketWithNames>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(HelpdeskTicket).createQueryBuilder('ticket');
      if (query.status) {
        qb.andWhere('ticket.status = :status', { status: query.status });
      }
      if (query.priority) {
        qb.andWhere('ticket.priority = :priority', { priority: query.priority });
      }
      if (query.assigneeAccountId) {
        qb.andWhere('ticket.assigneeAccountId = :assigneeAccountId', {
          assigneeAccountId: query.assigneeAccountId,
        });
      }
      if (query.q) {
        qb.andWhere('(ticket.title ILIKE :q OR ticket.description ILIKE :q)', {
          q: `%${query.q}%`,
        });
      }
      qb.orderBy('ticket.createdAt', 'DESC');
      const result = await paginate(qb, query);
      if (result.data.length === 0) {
        return { ...result, data: [] };
      }
      const nameByAccountId = await this.bulkLookupAccountNames(manager, result.data);
      return {
        ...result,
        data: result.data.map((ticket) => ({
          ...ticket,
          requesterName: nameByAccountId.get(ticket.requesterAccountId) ?? null,
          assigneeName: ticket.assigneeAccountId ? nameByAccountId.get(ticket.assigneeAccountId) ?? null : null,
        })),
      };
    });
  }

  async getTicket(id: string): Promise<HelpdeskTicketWithNames> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const ticket = await manager.getRepository(HelpdeskTicket).findOne({ where: { id } });
      if (!ticket) {
        throw new NotFoundException(`Helpdesk ticket ${id} not found`);
      }
      const nameByAccountId = await this.bulkLookupAccountNames(manager, [ticket]);
      return {
        ...ticket,
        requesterName: nameByAccountId.get(ticket.requesterAccountId) ?? null,
        assigneeName: ticket.assigneeAccountId ? nameByAccountId.get(ticket.assigneeAccountId) ?? null : null,
      };
    });
  }

  /**
   * Requester/assignee were previously exposed only as raw accountIds — nothing in this codebase's
   * frontend resolves an accountId to a name outside `/accounts/directory`, which requires knowing
   * the account's role up front (not knowable for an arbitrary requester). Joining displayName in
   * here, the same way lab/radiology join patientId in, avoids needing a new generic resolver
   * (code-review-findings-2026-09-02 helpdesk: requester/description never shown anywhere in the UI).
   * Raw SQL, not a TypeORM relation, matching `assignTicket`'s existing accounts lookup above — no
   * cross-module ORM relation between helpdesk and accounts.
   */
  private async bulkLookupAccountNames(
    manager: EntityManager,
    tickets: Pick<HelpdeskTicket, 'requesterAccountId' | 'assigneeAccountId'>[],
  ): Promise<Map<string, string>> {
    const accountIds = new Set<string>();
    for (const ticket of tickets) {
      accountIds.add(ticket.requesterAccountId);
      if (ticket.assigneeAccountId) accountIds.add(ticket.assigneeAccountId);
    }
    const rows: Array<{ id: string; displayName: string }> = await manager.query(
      `SELECT id, "displayName" FROM accounts WHERE id = ANY($1)`,
      [Array.from(accountIds)],
    );
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }
}
