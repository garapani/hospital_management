import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service.js';
import { HelpdeskTicketNumberGeneratorService } from './helpdesk-ticket-number-generator.service.js';
import { Account } from '../accounts/entities/account.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('HelpdeskService (integration)', () => {
  let ctx: TenantTestContext;
  let helpdeskService: HelpdeskService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'helpdesk' });
    helpdeskService = new HelpdeskService(
      ctx.tenantConnection,
      new HelpdeskTicketNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
    );
    // assignTicket now validates the assignee is a real, active account (P3) — STAFF_ID must
    // have a backing row for the assign specs.
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Account).save(
          manager.getRepository(Account).create({
            id: STAFF_ID,
            accountType: 'staff',
            displayName: 'Helpdesk Staff',
            isActive: true,
          }),
        ),
      ),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'helpdesk-test' },
      work,
    );
  }

  let seq = 0;
  async function makeTicket(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return ctx.inTenant(() =>
      helpdeskService.createTicket({
        title: `Printer jam ${seq}`,
        description: `Floor ${seq} printer needs toner`,
        requesterAccountId: STAFF_ID,
        ...overrides,
      }),
    );
  }

  it('creates tickets with an auto HLP number and validates input', async () => {
    const ticket = await makeTicket();
    expect(ticket.ticketNumber).toMatch(/^HLP-\d{4}-\d+$/);
    expect(ticket.status).toBe('Open');
    expect(ticket.priority).toBe('Medium');
    expect(ticket.requesterAccountId).toBe(STAFF_ID);

    await expect(
      ctx.inTenant(() =>
        helpdeskService.createTicket({ title: '   ', description: 'x', requesterAccountId: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        helpdeskService.createTicket({ title: 'x', description: '', requesterAccountId: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        helpdeskService.createTicket({
          title: 'x',
          description: 'y',
          priority: 'Blocker' as never,
          requesterAccountId: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    await expect(ctx.inTenant(() => helpdeskService.getTicket('00000000-0000-0000-0000-000000000000'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('runs the full lifecycle and rejects invalid moves', async () => {
    const ticket = await makeTicket();

    // Cannot close a ticket straight from Open (must be Resolved first).
    await expect(ctx.inTenant(() => helpdeskService.closeTicket(ticket.id))).rejects.toThrow(
      ConflictException,
    );

    const assigned = await ctx.inTenant(() => helpdeskService.assignTicket(ticket.id, STAFF_ID));
    expect(assigned.assigneeAccountId).toBe(STAFF_ID);
    expect(assigned.status).toBe('Open');

    const started = await ctx.inTenant(() => helpdeskService.startTicket(ticket.id));
    expect(started.status).toBe('InProgress');
    // Cannot start a ticket that is already InProgress.
    await expect(ctx.inTenant(() => helpdeskService.startTicket(ticket.id))).rejects.toThrow(
      ConflictException,
    );

    const resolved = await ctx.inTenant(() => helpdeskService.resolveTicket(ticket.id));
    expect(resolved.status).toBe('Resolved');
    expect(resolved.resolvedAt).not.toBeNull();

    const closed = await ctx.inTenant(() => helpdeskService.closeTicket(ticket.id));
    expect(closed.status).toBe('Closed');
    expect(closed.closedAt).not.toBeNull();

    // Terminal state: no further transitions.
    await expect(ctx.inTenant(() => helpdeskService.resolveTicket(ticket.id))).rejects.toThrow(
      ConflictException,
    );
    await expect(ctx.inTenant(() => helpdeskService.assignTicket(ticket.id, STAFF_ID))).rejects.toThrow(
      ConflictException,
    );
  });

  it('joins requesterName/assigneeName from accounts.displayName, on both getTicket and listTickets', async () => {
    const ticket = await makeTicket();
    expect(ticket.assigneeAccountId).toBeNull();

    const fetched = await ctx.inTenant(() => helpdeskService.getTicket(ticket.id));
    expect(fetched.requesterName).toBe('Helpdesk Staff');
    expect(fetched.assigneeName).toBeNull(); // no assignee yet

    await ctx.inTenant(() => helpdeskService.assignTicket(ticket.id, STAFF_ID));
    const reFetched = await ctx.inTenant(() => helpdeskService.getTicket(ticket.id));
    expect(reFetched.assigneeName).toBe('Helpdesk Staff');

    const list = await ctx.inTenant(() => helpdeskService.listTickets({ q: fetched.title }));
    const listed = list.data.find((t) => t.id === ticket.id)!;
    expect(listed.requesterName).toBe('Helpdesk Staff');
    expect(listed.assigneeName).toBe('Helpdesk Staff');
  });

  it('rejects assigning to a nonexistent or deactivated account', async () => {
    const ticket = await makeTicket();

    // Unknown account (P3 — previously the assignee was never validated).
    await expect(
      ctx.inTenant(() =>
        helpdeskService.assignTicket(ticket.id, '00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toThrow(NotFoundException);

    // Deactivated account.
    const inactive = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Account).save(
          manager.getRepository(Account).create({
            accountType: 'staff',
            displayName: 'Inactive Assignee',
            isActive: false,
          }),
        ),
      ),
    );
    await expect(
      ctx.inTenant(() => helpdeskService.assignTicket(ticket.id, inactive.id)),
    ).rejects.toThrow(ConflictException);
  });

  it('derives requesterAccountId and resolvedBy from the authenticated principal', async () => {
    const spoofed = '00000000-0000-4000-8000-0000000000ff';
    const ticket = await withActor(() =>
      helpdeskService.createTicket({
        title: 'Actor derivation',
        description: 'who raised this ticket?',
        requesterAccountId: spoofed,
      }),
    );
    // Section 25: the authenticated principal wins over any caller-supplied value.
    expect(ticket.requesterAccountId).toBe(AUTHENTICATED_ACCOUNT);

    const resolved = await withActor(() => helpdeskService.resolveTicket(ticket.id));
    expect(resolved.status).toBe('Resolved');
    expect(resolved.resolvedBy).toBe(AUTHENTICATED_ACCOUNT);
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('filters tickets by status, priority, assignee, and q search', async () => {
    await makeTicket({ title: 'UPS battery replacement', description: 'Server room UPS beeping' });
    await makeTicket({ title: 'Cubicle 12 chair', description: 'Broken armrest' });
    const urgent = await makeTicket({ title: 'Billing outage', description: 'Billing app is down', priority: 'Urgent' });

    const urgentList = await ctx.inTenant(() => helpdeskService.listTickets({ priority: 'Urgent' }));
    expect(urgentList.data.map((t) => t.id)).toContain(urgent.id);

    const qTitle = await ctx.inTenant(() => helpdeskService.listTickets({ q: 'UPS' }));
    expect(qTitle.data).toHaveLength(1);
    expect(qTitle.data[0].title).toBe('UPS battery replacement');

    const qDescription = await ctx.inTenant(() => helpdeskService.listTickets({ q: 'armrest' }));
    expect(qDescription.data).toHaveLength(1);

    await ctx.inTenant(() => helpdeskService.assignTicket(urgent.id, STAFF_ID));
    const assignedList = await ctx.inTenant(() => helpdeskService.listTickets({ assigneeAccountId: STAFF_ID }));
    expect(assignedList.data.map((t) => t.id)).toContain(urgent.id);

    const openList = await ctx.inTenant(() => helpdeskService.listTickets({ status: 'Open' }));
    expect(openList.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const ticket = await makeTicket();
    await expect(tenantB.inTenant(() => helpdeskService.getTicket(ticket.id))).rejects.toThrow(
      NotFoundException,
    );
    const list = await tenantB.inTenant(() => helpdeskService.listTickets({}));
    expect(list.data.map((t) => t.id)).not.toContain(ticket.id);
  });
});
