import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CssdService } from './cssd.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('CssdService (integration)', () => {
  let ctx: TenantTestContext;
  let cssdService: CssdService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'cssd' });
    cssdService = new CssdService(ctx.tenantConnection, ctx.tenantContext);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'cssd-test' },
      work,
    );
  }

  let seq = 0;

  async function makeInstrument(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return ctx.inTenant(() =>
      cssdService.createInstrument({
        code: `CSSD-INS-${String(seq).padStart(4, '0')}`,
        name: `Scalpel Set ${seq}`,
        ...overrides,
      }),
    );
  }

  async function makeCycle(instrumentId: string, overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() =>
      cssdService.startCycle({
        instrumentId,
        method: 'Steam',
        operatedBy: STAFF_ID,
        ...overrides,
      }),
    );
  }

  it('creates, updates and soft-deletes instruments', async () => {
    const instrument = await makeInstrument({ category: 'Surgical', quantity: 5 });
    expect(instrument.code).toBe('CSSD-INS-0001');
    expect(instrument.name).toBe('Scalpel Set 1');
    expect(instrument.category).toBe('Surgical');
    expect(instrument.quantity).toBe(5);
    expect(instrument.isActive).toBe(true);

    // quantity defaults to 0 when omitted
    const bare = await makeInstrument({ category: 'General' });
    expect(bare.quantity).toBe(0);

    const updated = await ctx.inTenant(() =>
      cssdService.updateInstrument(instrument.id, { name: 'Scalpel Set 1 (Large)', quantity: 8 }),
    );
    expect(updated.name).toBe('Scalpel Set 1 (Large)');
    expect(updated.quantity).toBe(8);
    expect(updated.category).toBe('Surgical');

    const deactivated = await ctx.inTenant(() => cssdService.deactivateInstrument(instrument.id));
    expect(deactivated.isActive).toBe(false);

    // Double deactivate conflicts.
    await expect(ctx.inTenant(() => cssdService.deactivateInstrument(instrument.id))).rejects.toThrow(
      ConflictException,
    );

    const reactivated = await ctx.inTenant(() => cssdService.reactivateInstrument(instrument.id));
    expect(reactivated.isActive).toBe(true);
  });

  it('validates instrument inputs and unknown ids', async () => {
    await expect(
      ctx.inTenant(() => cssdService.createInstrument({ code: '   ', name: 'Forceps' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => cssdService.createInstrument({ code: 'F-1', name: '' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => cssdService.createInstrument({ code: 'F-2', name: 'Forceps', quantity: -1 })),
    ).rejects.toThrow(BadRequestException);

    const instrument = await makeInstrument();
    await expect(
      ctx.inTenant(() => cssdService.updateInstrument(instrument.id, { quantity: -3 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => cssdService.updateInstrument(instrument.id, { name: '  ' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => cssdService.updateInstrument('00000000-0000-0000-0000-000000000000', { name: 'x' })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => cssdService.deactivateInstrument('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => cssdService.reactivateInstrument('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists instruments ordered by code', async () => {
    const instruments = await ctx.inTenant(() => cssdService.listInstruments());
    expect(instruments.length).toBeGreaterThanOrEqual(2);
    const codes = instruments.map((i) => i.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it('runs the cycle lifecycle (start -> complete) with sterile expiry', async () => {
    const instrument = await makeInstrument();
    const cycle = await makeCycle(instrument.id);
    expect(cycle.status).toBe('InProgress');
    expect(cycle.method).toBe('Steam');
    expect(cycle.startedAt).not.toBeNull();
    expect(cycle.completedAt).toBeNull();
    expect(cycle.sterileExpiryAt).toBeNull();
    // Non-HTTP caller: the fallback keeps NOT NULL operatedBy satisfied.
    expect(cycle.operatedBy).toBe(STAFF_ID);

    const completed = await ctx.inTenant(() =>
      cssdService.completeCycle(cycle.id, { sterileHours: 24, operatedBy: STAFF_ID }),
    );
    expect(completed.status).toBe('Completed');
    expect(completed.completedAt).not.toBeNull();
    // sterileExpiryAt = completedAt + sterileHours, exactly.
    const expectedExpiry = new Date(
      (completed.completedAt as Date).getTime() + 24 * 60 * 60 * 1000,
    );
    expect(completed.sterileExpiryAt?.getTime()).toBe(expectedExpiry.getTime());
    expect(completed.operatedBy).toBe(STAFF_ID);

    const fetched = await ctx.inTenant(() => cssdService.getCycle(cycle.id));
    expect(fetched.status).toBe('Completed');
    expect(fetched.sterileExpiryAt?.getTime()).toBe(expectedExpiry.getTime());
  });

  it('fails an InProgress cycle, requiring a failure reason', async () => {
    const instrument = await makeInstrument();
    const cycle = await makeCycle(instrument.id);

    await expect(
      ctx.inTenant(() => cssdService.failCycle(cycle.id, { failureReason: '   ' })),
    ).rejects.toThrow(BadRequestException);

    const failed = await ctx.inTenant(() =>
      cssdService.failCycle(cycle.id, { failureReason: 'Temperature out of range' }),
    );
    expect(failed.status).toBe('Failed');
    expect(failed.failureReason).toBe('Temperature out of range');
    expect(failed.completedAt).toBeNull();
    expect(failed.sterileExpiryAt).toBeNull();
  });

  it('enforces cycle status transitions with ConflictException', async () => {
    const instrument = await makeInstrument();

    // A Failed cycle cannot be completed.
    const failed = await makeCycle(instrument.id, { method: 'ETO' });
    await ctx.inTenant(() =>
      cssdService.failCycle(failed.id, { failureReason: 'Leak detected' }),
    );
    await expect(
      ctx.inTenant(() => cssdService.completeCycle(failed.id, { sterileHours: 12 })),
    ).rejects.toThrow(ConflictException);

    // A Completed cycle cannot be completed or failed again.
    const done = await makeCycle(instrument.id);
    await ctx.inTenant(() => cssdService.completeCycle(done.id, { sterileHours: 8 }));
    await expect(
      ctx.inTenant(() => cssdService.completeCycle(done.id, { sterileHours: 8 })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => cssdService.failCycle(done.id, { failureReason: 'late' }) as never),
    ).rejects.toThrow(ConflictException);

    // An InProgress cycle cannot be completed twice.
    const inProgress = await makeCycle(instrument.id);
    await ctx.inTenant(() => cssdService.completeCycle(inProgress.id, { sterileHours: 8 }));
    await expect(
      ctx.inTenant(() => cssdService.completeCycle(inProgress.id, { sterileHours: 8 })),
    ).rejects.toThrow(ConflictException);

    await expect(
      ctx.inTenant(() => cssdService.completeCycle('00000000-0000-0000-0000-000000000000', { sterileHours: 8 })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => cssdService.failCycle('00000000-0000-0000-0000-000000000000', { failureReason: 'x' })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => cssdService.getCycle('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('validates cycle inputs and the instrument reference', async () => {
    await expect(
      ctx.inTenant(() => cssdService.startCycle({ instrumentId: '00000000-0000-0000-0000-000000000000', method: 'Steam' })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => cssdService.startCycle({ instrumentId: '00000000-0000-0000-0000-000000000000', method: 'Fog' as never })),
    ).rejects.toThrow(BadRequestException);

    const instrument = await makeInstrument();
    await expect(
      ctx.inTenant(() => cssdService.startCycle({ instrumentId: instrument.id, method: 'Plasma' as never })),
    ).rejects.toThrow(BadRequestException);

    const cycle = await makeCycle(instrument.id);
    await expect(
      ctx.inTenant(() => cssdService.completeCycle(cycle.id, { sterileHours: 0 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => cssdService.completeCycle(cycle.id, { sterileHours: -5 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects new cycles for a deactivated instrument', async () => {
    const instrument = await makeInstrument();
    await ctx.inTenant(() => cssdService.deactivateInstrument(instrument.id));
    await expect(
      ctx.inTenant(() => cssdService.startCycle({ instrumentId: instrument.id, method: 'Steam' })),
    ).rejects.toThrow(ConflictException);

    // Reactivation re-enables cycle starts.
    await ctx.inTenant(() => cssdService.reactivateInstrument(instrument.id));
    const cycle = await ctx.inTenant(() =>
      cssdService.startCycle({ instrumentId: instrument.id, method: 'Chemical', operatedBy: STAFF_ID }),
    );
    expect(cycle.status).toBe('InProgress');
  });

  it('lists cycles paginated and filterable by instrument and status', async () => {
    const instrumentA = await makeInstrument();
    const instrumentB = await makeInstrument();
    const a1 = await makeCycle(instrumentA.id);
    // Only one InProgress cycle may exist per instrument, so a1 is completed before a2 starts.
    await ctx.inTenant(() => cssdService.completeCycle(a1.id, { sterileHours: 12 }));
    const a2 = await makeCycle(instrumentA.id, { method: 'ETO' });
    await makeCycle(instrumentB.id);

    const all = await ctx.inTenant(() => cssdService.listCycles({}));
    expect(all.meta.total).toBeGreaterThanOrEqual(3);

    const byInstrument = await ctx.inTenant(() => cssdService.listCycles({ instrumentId: instrumentA.id }));
    expect(byInstrument.meta.total).toBe(2);
    expect(byInstrument.data.every((c) => c.instrumentId === instrumentA.id)).toBe(true);
    expect(new Set(byInstrument.data.map((c) => c.id))).toEqual(new Set([a1.id, a2.id]));

    const inProgress = await ctx.inTenant(() => cssdService.listCycles({ status: 'InProgress' }));
    expect(inProgress.data.every((c) => c.status === 'InProgress')).toBe(true);

    const byStatus = await ctx.inTenant(() =>
      cssdService.listCycles({ instrumentId: instrumentA.id, status: 'Completed' }),
    );
    expect(byStatus.meta.total).toBe(1);
    expect(byStatus.data[0].id).toBe(a1.id);

    const page = await ctx.inTenant(() => cssdService.listCycles({ instrumentId: instrumentA.id, limit: 1, page: 2 }));
    expect(page.meta.page).toBe(2);
    expect(page.meta.limit).toBe(1);
    expect(page.meta.total).toBe(2);
    expect(page.data).toHaveLength(1);
    // Newest first (createdAt DESC): page 2 holds the older cycle.
    expect(page.data[0].id).toBe(a1.id);
  });

  it('rejects a duplicate instrument code with ConflictException', async () => {
    const instrument = await makeInstrument();
    await expect(
      ctx.inTenant(() =>
        cssdService.createInstrument({ code: instrument.code, name: 'Duplicate code instrument' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('prevents concurrent InProgress cycles for the same instrument', async () => {
    const instrument = await makeInstrument();
    const first = await makeCycle(instrument.id);
    expect(first.status).toBe('InProgress');

    // A second InProgress cycle on the same instrument is rejected.
    await expect(
      ctx.inTenant(() => cssdService.startCycle({ instrumentId: instrument.id, method: 'Steam' })),
    ).rejects.toThrow(ConflictException);

    // Once the first cycle leaves InProgress, a new one may start.
    await ctx.inTenant(() => cssdService.completeCycle(first.id, { sterileHours: 24 }));
    const second = await ctx.inTenant(() =>
      cssdService.startCycle({ instrumentId: instrument.id, method: 'ETO', operatedBy: STAFF_ID }),
    );
    expect(second.status).toBe('InProgress');
  });

  it('rejects reactivating an already-active instrument', async () => {
    const instrument = await makeInstrument();
    await expect(
      ctx.inTenant(() => cssdService.reactivateInstrument(instrument.id)),
    ).rejects.toThrow(ConflictException);
  });

  it('reports instrument sterility from the latest completed cycle', async () => {
    const instrument = await makeInstrument();

    // No completed cycle yet -> not sterile.
    const bare = await ctx.inTenant(() => cssdService.getSterility(instrument.id));
    expect(bare.isSterile).toBe(false);
    expect(bare.sterileExpiryAt).toBeNull();

    // Raw-insert two completed cycles: a fresh one (future expiry) then an expired one, so the
    // expired one is the latest and drives the answer. completedAt values are explicit to make
    // the ordering deterministic.
    const rawInsert = (completedAt: string, sterileExpiryAt: string) =>
      ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.query(
            `INSERT INTO cssd_sterilization_cycles
               ("instrumentId", method, status, "startedAt", "completedAt", "sterileExpiryAt", "operatedBy")
             VALUES ($1, 'Steam', 'Completed', $2, $2, $3, $4)`,
            [instrument.id, completedAt, sterileExpiryAt, STAFF_ID],
          ),
        ),
      );
    await rawInsert('2026-08-01T10:00:00Z', '2026-08-02T10:00:00Z');
    await rawInsert('2026-08-26T10:00:00Z', '2026-08-25T10:00:00Z'); // expired, but latest

    const expired = await ctx.inTenant(() => cssdService.getSterility(instrument.id));
    expect(expired.isSterile).toBe(false);
    expect(expired.lastCompletedAt?.toISOString()).toBe('2026-08-26T10:00:00.000Z');
    expect(expired.sterileExpiryAt?.toISOString()).toBe('2026-08-25T10:00:00.000Z');

    // A fresh latest cycle flips it back to sterile. Computed relative to the actual run time
    // rather than a hardcoded future literal — the previous hardcoded '2026-09-01' rotted the
    // moment the calendar caught up to it (review-comments.md "Two integration specs assert a
    // hardcoded elapsed-time value against the real wall clock"). completedAt just needs to be
    // later than the other two raw-inserted rows above (both in 2026-08); Date.now() always is.
    const freshCompletedAt = new Date();
    const freshExpiryAt = new Date(freshCompletedAt.getTime() + 24 * 60 * 60 * 1000);
    await rawInsert(freshCompletedAt.toISOString(), freshExpiryAt.toISOString());
    const sterile = await ctx.inTenant(() => cssdService.getSterility(instrument.id));
    expect(sterile.isSterile).toBe(true);
    expect(sterile.sterileExpiryAt?.toISOString()).toBe(freshExpiryAt.toISOString());
  });

  it('derives operatedBy from the authenticated principal, ignoring spoofed values', async () => {
    const instrument = await withActor(() =>
      cssdService.createInstrument({ code: 'CSSD-ACTOR-1', name: 'Actor Scalpel' }),
    );

    const cycle = await withActor(() =>
      cssdService.startCycle({ instrumentId: instrument.id, method: 'Steam', operatedBy: 'spoofed' }),
    );
    expect(cycle.operatedBy).toBe(AUTHENTICATED_ACCOUNT);

    const completed = await withActor(() =>
      cssdService.completeCycle(cycle.id, { sterileHours: 24, operatedBy: 'spoofed' }),
    );
    expect(completed.operatedBy).toBe(AUTHENTICATED_ACCOUNT);

    // A fresh cycle is failed by the authenticated actor; a Completed cycle cannot be failed.
    const failedCycle = await withActor(() =>
      cssdService.startCycle({ instrumentId: instrument.id, method: 'ETO', operatedBy: 'spoofed' }),
    );
    const failed = await withActor(() =>
      cssdService.failCycle(failedCycle.id, { failureReason: 'Sensor error', operatedBy: 'spoofed' }),
    );
    expect(failed.operatedBy).toBe(AUTHENTICATED_ACCOUNT);

    // Non-HTTP caller without a tenant context: the fallback keeps NOT NULL operatedBy satisfied.
    const fallback = await makeCycle(instrument.id);
    expect(fallback.operatedBy).toBe(STAFF_ID);
  });

  it('enforces tenant isolation for instruments and cycles', async () => {
    const tenantB = await ctx.createTenant();
    const instrument = await makeInstrument();
    const cycle = await makeCycle(instrument.id);

    // Tenant B sees none of tenant A's records.
    const tenantBInstruments = await tenantB.inTenant(() => cssdService.listInstruments());
    expect(tenantBInstruments).toHaveLength(0);
    const tenantBCycles = await tenantB.inTenant(() => cssdService.listCycles({}));
    expect(tenantBCycles.meta.total).toBe(0);

    // Tenant B cannot act on tenant A's rows.
    await expect(
      tenantB.inTenant(() => cssdService.getCycle(cycle.id)),
    ).rejects.toThrow(NotFoundException);
    await expect(
      tenantB.inTenant(() => cssdService.completeCycle(cycle.id, { sterileHours: 12 })),
    ).rejects.toThrow(NotFoundException);
    await expect(
      tenantB.inTenant(() => cssdService.startCycle({ instrumentId: instrument.id, method: 'Steam' })),
    ).rejects.toThrow(NotFoundException);

    // Tenant A is untouched by tenant B's activity.
    const instruments = await ctx.inTenant(() => cssdService.listInstruments());
    expect(instruments.some((i) => i.id === instrument.id)).toBe(true);
    const cycles = await ctx.inTenant(() => cssdService.listCycles({ instrumentId: instrument.id }));
    expect(cycles.meta.total).toBe(1);
    expect(cycles.data[0].id).toBe(cycle.id);
  });
});
