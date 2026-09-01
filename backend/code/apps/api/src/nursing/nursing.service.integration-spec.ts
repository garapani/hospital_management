import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NursingService } from './nursing.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('NursingService (integration)', () => {
  let ctx: TenantTestContext;
  let nursingService: NursingService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'nursing' });
    nursingService = new NursingService(ctx.tenantConnection, ctx.tenantContext);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'nursing-test' },
      work,
    );
  }

  /** Simulates a ward-assigned staff member's request context (the JWT's wardId claim,
   *  see auth-context.middleware.ts). Bypasses ctx.inTenant() (which never sets wardId)
   *  since it always exercises the tenant-wide, unassigned-staff default. */
  function withWard<T>(wardId: string, work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run({ tenantId: ctx.tenantId, wardId, correlationId: 'nursing-ward-test' }, work);
  }

  const WARD_A = '00000000-0000-4000-8000-0000000000c2';
  const WARD_B = '00000000-0000-4000-8000-0000000000c3';

  let seq = 0;

  /** Inserts an admission row directly — nursing validates existence via raw query only.
   *  Each call uses a distinct patientId: admissions.patientId is now (correctly) unique
   *  per active admission, so reusing one patientId across rows would collide. */
  async function makeAdmission(tenant: TenantTestContext = ctx, wardId: string = WARD_A): Promise<string> {
    seq += 1;
    const rows = await tenant.inTenant(() =>
      tenant.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO admissions ("patientId", "admissionSource", "admittingDoctorId", "wardId", "bedId")
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [
            `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
            'OPD',
            STAFF_ID,
            wardId,
            `00000000-0000-0000-0000-b${String(seq).padStart(11, '0')}`,
          ],
        ),
      ),
    );
    return rows[0].id;
  }

  /** Raw-inserts a prescription row — nursing validates its existence via raw query only. */
  async function makePrescription(): Promise<string> {
    seq += 1;
    const rows = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO prescriptions ("patientId", "doctorId", "medicationName", "dosage", "frequency", "route", "durationDays")
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [
            `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
            STAFF_ID,
            'Amoxicillin',
            '500mg',
            'TID',
            'Oral',
            7,
          ],
        ),
      ),
    );
    return rows[0].id;
  }

  async function makeTask(admissionId: string, overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() =>
      nursingService.createTask({
        admissionId,
        taskType: 'Vitals Check',
        description: 'Record vitals every 4 hours',
        createdBy: STAFF_ID,
        ...overrides,
      }),
    );
  }

  async function makeAdministration(admissionId: string, overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() =>
      nursingService.createAdministration({
        admissionId,
        drugName: 'Paracetamol',
        dose: '500mg',
        ...overrides,
      }),
    );
  }

  it('runs the task lifecycle (create -> start -> complete) with actor derivation', async () => {
    const admissionId = await makeAdmission();
    const task = await makeTask(admissionId);
    expect(task.status).toBe('Pending');
    expect(task.taskType).toBe('Vitals Check');
    expect(task.createdBy).toBe(STAFF_ID);

    const started = await ctx.inTenant(() => nursingService.startTask(task.id));
    expect(started.status).toBe('InProgress');

    const completed = await withActor(() => nursingService.completeTask(task.id));
    expect(completed.status).toBe('Completed');
    expect(completed.completedAt).not.toBeNull();
    // §25: the authenticated principal wins over any caller-supplied value.
    expect(completed.completedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('enforces task status transitions with ConflictException', async () => {
    const admissionId = await makeAdmission();

    // A Pending task cannot be completed directly.
    const pending = await makeTask(admissionId);
    await expect(ctx.inTenant(() => nursingService.completeTask(pending.id))).rejects.toThrow(
      ConflictException,
    );

    // A Pending task cannot be cancelled after it has started.
    const started = await makeTask(admissionId);
    await ctx.inTenant(() => nursingService.startTask(started.id));
    await expect(ctx.inTenant(() => nursingService.cancelTask(started.id))).rejects.toThrow(
      ConflictException,
    );

    // A Completed task cannot be started again.
    const done = await makeTask(admissionId);
    await ctx.inTenant(() => nursingService.startTask(done.id));
    await ctx.inTenant(() => nursingService.completeTask(done.id));
    await expect(ctx.inTenant(() => nursingService.startTask(done.id))).rejects.toThrow(
      ConflictException,
    );
    await expect(ctx.inTenant(() => nursingService.completeTask(done.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it('cancels a Pending task, recording the actor and timestamp like a completion', async () => {
    const admissionId = await makeAdmission();
    const task = await makeTask(admissionId);

    const cancelled = await withActor(() => nursingService.cancelTask(task.id, 'spoofed'));
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.completedAt).not.toBeNull();
    expect(cancelled.completedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('validates task inputs and the admission reference', async () => {
    const admissionId = await makeAdmission();
    await expect(
      ctx.inTenant(() =>
        nursingService.createTask({ admissionId, taskType: '   ', description: 'x', createdBy: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        nursingService.createTask({ admissionId, taskType: 'Dressing', description: '', createdBy: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        nursingService.createTask({
          admissionId: '00000000-0000-0000-0000-000000000000',
          taskType: 'Dressing',
          description: 'x',
          createdBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => nursingService.startTask('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists tasks paginated and filterable by admission', async () => {
    const admissionA = await makeAdmission();
    const admissionB = await makeAdmission();
    await makeTask(admissionA);
    await makeTask(admissionA);
    await makeTask(admissionB);

    const all = await ctx.inTenant(() => nursingService.listTasks({}));
    expect(all.meta.total).toBeGreaterThanOrEqual(3);

    const byAdmission = await ctx.inTenant(() => nursingService.listTasks({ admissionId: admissionA }));
    expect(byAdmission.meta.total).toBe(2);
    expect(byAdmission.data.every((t) => t.admissionId === admissionA)).toBe(true);

    const page = await ctx.inTenant(() => nursingService.listTasks({ admissionId: admissionA, limit: 1, page: 2 }));
    expect(page.meta.page).toBe(2);
    expect(page.meta.limit).toBe(1);
    expect(page.meta.total).toBe(2);
    expect(page.data).toHaveLength(1);
  });

  it('runs the MAR lifecycle (create -> administer) with actor derivation', async () => {
    const admissionId = await makeAdmission();
    const administration = await makeAdministration(admissionId, {
      route: 'Oral',
      scheduledAt: '2026-01-01T08:00:00Z',
      notes: 'After food',
    });
    expect(administration.status).toBe('Scheduled');
    expect(administration.drugName).toBe('Paracetamol');
    expect(administration.route).toBe('Oral');
    expect(administration.scheduledAt).not.toBeNull();
    expect(administration.administeredBy).toBeNull();

    const administered = await withActor(() => nursingService.administer(administration.id));
    expect(administered.status).toBe('Administered');
    expect(administered.administeredAt).not.toBeNull();
    // §25: the authenticated principal wins over any caller-supplied value.
    expect(administered.administeredBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('skips a Scheduled administration, recording the reason', async () => {
    const admissionId = await makeAdmission();
    const administration = await makeAdministration(admissionId);

    const skipped = await withActor(() =>
      nursingService.skipAdministration(administration.id, 'Patient refused'),
    );
    expect(skipped.status).toBe('Skipped');
    expect(skipped.notes).toBe('Patient refused');
    expect(skipped.administeredBy).toBeNull();
    expect(skipped.administeredAt).toBeNull();
    // §25: a skip now records an actor too, distinct from administeredBy.
    expect(skipped.skippedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('enforces MAR status transitions with ConflictException', async () => {
    const admissionId = await makeAdmission();

    const administered = await makeAdministration(admissionId);
    await ctx.inTenant(() => nursingService.administer(administered.id));
    await expect(ctx.inTenant(() => nursingService.administer(administered.id))).rejects.toThrow(
      ConflictException,
    );
    await expect(
      ctx.inTenant(() => nursingService.skipAdministration(administered.id, 'late')),
    ).rejects.toThrow(ConflictException);

    const skipped = await makeAdministration(admissionId);
    await ctx.inTenant(() => nursingService.skipAdministration(skipped.id, 'NPO'));
    await expect(ctx.inTenant(() => nursingService.administer(skipped.id))).rejects.toThrow(
      ConflictException,
    );
  });

  it('validates MAR inputs and the admission reference', async () => {
    const admissionId = await makeAdmission();
    await expect(
      ctx.inTenant(() => nursingService.createAdministration({ admissionId, drugName: '', dose: '5mg' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => nursingService.createAdministration({ admissionId, drugName: 'Aspirin', dose: '  ' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        nursingService.createAdministration({
          admissionId: '00000000-0000-0000-0000-000000000000',
          drugName: 'Aspirin',
          dose: '5mg',
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() => nursingService.administer('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('links an administration to a real prescription, and rejects a nonexistent one', async () => {
    const admissionId = await makeAdmission();
    const prescriptionId = await makePrescription();

    const administration = await ctx.inTenant(() =>
      nursingService.createAdministration({
        admissionId,
        prescriptionId,
        drugName: 'Amoxicillin',
        dose: '500mg',
      }),
    );
    expect(administration.prescriptionId).toBe(prescriptionId);

    await expect(
      ctx.inTenant(() =>
        nursingService.createAdministration({
          admissionId,
          prescriptionId: '00000000-0000-0000-0000-000000000000',
          drugName: 'Amoxicillin',
          dose: '500mg',
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects creating a task or MAR line against a discharged admission', async () => {
    const admissionId = await makeAdmission();
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(`UPDATE admissions SET status = 'Discharged' WHERE id = $1`, [admissionId]),
      ),
    );

    await expect(
      ctx.inTenant(() =>
        nursingService.createTask({ admissionId, taskType: 'Vitals Check', description: 'x' }),
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() =>
        nursingService.createAdministration({ admissionId, drugName: 'Aspirin', dose: '5mg' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('lists administrations paginated and filterable by admission', async () => {
    const admissionId = await makeAdmission();
    await makeAdministration(admissionId, { drugName: 'Amoxicillin', dose: '250mg' });
    await makeAdministration(admissionId, { drugName: 'Insulin', dose: '10 units' });

    const all = await ctx.inTenant(() => nursingService.listAdministrations({ admissionId }));
    expect(all.meta.total).toBe(2);
    expect(all.data.every((a) => a.admissionId === admissionId)).toBe(true);
  });

  it('derives actor fields from the authenticated principal, ignoring spoofed values', async () => {
    const admissionId = await makeAdmission();

    const task = await withActor(() =>
      nursingService.createTask({
        admissionId,
        taskType: 'Wound Care',
        description: 'Dressing change',
        createdBy: 'spoofed',
      }),
    );
    expect(task.createdBy).toBe(AUTHENTICATED_ACCOUNT);

    await ctx.inTenant(() => nursingService.startTask(task.id));
    const completed = await withActor(() => nursingService.completeTask(task.id, 'spoofed'));
    expect(completed.completedBy).toBe(AUTHENTICATED_ACCOUNT);

    const administration = await withActor(() =>
      nursingService.createAdministration({
        admissionId,
        drugName: 'Morphine',
        dose: '2mg',
      }),
    );
    const administered = await withActor(() => nursingService.administer(administration.id, 'spoofed'));
    expect(administered.administeredBy).toBe(AUTHENTICATED_ACCOUNT);

    // Non-HTTP caller without a tenant context: the fallback keeps NOT NULL columns satisfied.
    const fallbackTask = await ctx.inTenant(() =>
      nursingService.createTask({
        admissionId,
        taskType: 'Foley Care',
        description: 'Catheter care',
        createdBy: STAFF_ID,
      }),
    );
    expect(fallbackTask.createdBy).toBe(STAFF_ID);
  });

  it('enforces tenant isolation for tasks and administrations', async () => {
    const tenantB = await ctx.createTenant();
    const admissionId = await makeAdmission();
    const task = await makeTask(admissionId);
    const administration = await makeAdministration(admissionId);

    // Tenant B sees none of tenant A's records.
    const tenantBTasks = await tenantB.inTenant(() => nursingService.listTasks({}));
    expect(tenantBTasks.meta.total).toBe(0);
    const tenantBAdministrations = await tenantB.inTenant(() => nursingService.listAdministrations({}));
    expect(tenantBAdministrations.meta.total).toBe(0);

    // Tenant B cannot act on tenant A's rows.
    await expect(tenantB.inTenant(() => nursingService.startTask(task.id))).rejects.toThrow(NotFoundException);
    await expect(
      tenantB.inTenant(() => nursingService.completeTask(task.id)),
    ).rejects.toThrow(NotFoundException);
    await expect(
      tenantB.inTenant(() => nursingService.administer(administration.id)),
    ).rejects.toThrow(NotFoundException);

    // Tenant A is untouched by tenant B's activity.
    const tasks = await ctx.inTenant(() => nursingService.listTasks({ admissionId }));
    expect(tasks.meta.total).toBe(1);
    const administrations = await ctx.inTenant(() => nursingService.listAdministrations({ admissionId }));
    expect(administrations.meta.total).toBe(1);
  });

  describe('ward-scoped access', () => {
    it('lets a ward-assigned nurse act on an admission within her own ward', async () => {
      const admissionId = await makeAdmission(ctx, WARD_A);

      const task = await withWard(WARD_A, () =>
        nursingService.createTask({ admissionId, taskType: 'Vitals Check', description: 'x', createdBy: STAFF_ID }),
      );
      await withWard(WARD_A, () => nursingService.startTask(task.id));
      const completed = await withWard(WARD_A, () => nursingService.completeTask(task.id));
      expect(completed.status).toBe('Completed');

      const administration = await withWard(WARD_A, () =>
        nursingService.createAdministration({ admissionId, drugName: 'Paracetamol', dose: '500mg' }),
      );
      const administered = await withWard(WARD_A, () => nursingService.administer(administration.id));
      expect(administered.status).toBe('Administered');
    });

    it('denies a ward-assigned nurse acting on an admission outside her ward', async () => {
      const admissionId = await makeAdmission(ctx, WARD_B);

      await expect(
        withWard(WARD_A, () =>
          nursingService.createTask({ admissionId, taskType: 'Vitals Check', description: 'x' }),
        ),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        withWard(WARD_A, () =>
          nursingService.createAdministration({ admissionId, drugName: 'Paracetamol', dose: '500mg' }),
        ),
      ).rejects.toThrow(ForbiddenException);

      const task = await makeTask(admissionId);
      await expect(withWard(WARD_A, () => nursingService.startTask(task.id))).rejects.toThrow(
        ForbiddenException,
      );
      const administration = await makeAdministration(admissionId);
      await expect(withWard(WARD_A, () => nursingService.administer(administration.id))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('scopes unfiltered task/administration listings to the nurse\'s own ward', async () => {
      const admissionA = await makeAdmission(ctx, WARD_A);
      const admissionB = await makeAdmission(ctx, WARD_B);
      await makeTask(admissionA);
      await makeTask(admissionB);
      await makeAdministration(admissionA);
      await makeAdministration(admissionB);

      // Other tests in this file also create WARD_A admissions/tasks, so assert inclusion of
      // this test's own WARD_A task and exclusion of the WARD_B one, not exclusivity.
      const wardATasks = await withWard(WARD_A, () => nursingService.listTasks({}));
      expect(wardATasks.data.some((t) => t.admissionId === admissionA)).toBe(true);
      expect(wardATasks.data.some((t) => t.admissionId === admissionB)).toBe(false);

      const wardAAdministrations = await withWard(WARD_A, () => nursingService.listAdministrations({}));
      expect(wardAAdministrations.data.some((a) => a.admissionId === admissionA)).toBe(true);
      expect(wardAAdministrations.data.some((a) => a.admissionId === admissionB)).toBe(false);
    });

    it('denies listing another ward\'s tasks/administrations by explicit admissionId filter', async () => {
      const admissionId = await makeAdmission(ctx, WARD_B);
      await makeTask(admissionId);

      await expect(
        withWard(WARD_A, () => nursingService.listTasks({ admissionId })),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        withWard(WARD_A, () => nursingService.listAdministrations({ admissionId })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('leaves an unassigned staff member (no wardId) with unrestricted tenant-wide access', async () => {
      const admissionId = await makeAdmission(ctx, WARD_B);
      const task = await makeTask(admissionId);

      // ctx.inTenant() never sets wardId — this is the "no ward assigned" default already
      // exercised throughout the rest of this file; asserted explicitly here for the record.
      const started = await ctx.inTenant(() => nursingService.startTask(task.id));
      expect(started.status).toBe('InProgress');
    });
  });

  describe('shift handoff notes', () => {
    it('creates a handoff note with actor derivation, and validates its inputs', async () => {
      const admissionId = await makeAdmission();

      const note = await withActor(() =>
        nursingService.createHandoffNote({ admissionId, shift: 'Night', note: 'Watch for fever spikes.' }),
      );
      expect(note.note).toBe('Watch for fever spikes.');
      expect(note.shift).toBe('Night');
      expect(note.acknowledged).toBe(false);
      expect(note.createdBy).toBe(AUTHENTICATED_ACCOUNT);

      await expect(
        ctx.inTenant(() => nursingService.createHandoffNote({ admissionId, note: '   ' })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        ctx.inTenant(() =>
          nursingService.createHandoffNote({
            admissionId: '00000000-0000-0000-0000-000000000000',
            note: 'x',
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a handoff note for a discharged admission', async () => {
      const admissionId = await makeAdmission();
      await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.query(`UPDATE admissions SET status = 'Discharged' WHERE id = $1`, [admissionId]),
        ),
      );

      await expect(
        ctx.inTenant(() => nursingService.createHandoffNote({ admissionId, note: 'x' })),
      ).rejects.toThrow(ConflictException);
    });

    it('lists handoff notes paginated and filterable by admission', async () => {
      const admissionA = await makeAdmission();
      const admissionB = await makeAdmission();
      await ctx.inTenant(() => nursingService.createHandoffNote({ admissionId: admissionA, note: 'A1', createdBy: STAFF_ID }));
      await ctx.inTenant(() => nursingService.createHandoffNote({ admissionId: admissionA, note: 'A2', createdBy: STAFF_ID }));
      await ctx.inTenant(() => nursingService.createHandoffNote({ admissionId: admissionB, note: 'B1', createdBy: STAFF_ID }));

      const byAdmission = await ctx.inTenant(() => nursingService.listHandoffNotes({ admissionId: admissionA }));
      expect(byAdmission.meta.total).toBe(2);
      expect(byAdmission.data.every((n) => n.admissionId === admissionA)).toBe(true);
    });

    it('acknowledges a handoff note with actor derivation, and rejects acknowledging it twice', async () => {
      const admissionId = await makeAdmission();
      const note = await ctx.inTenant(() =>
        nursingService.createHandoffNote({ admissionId, note: 'x', createdBy: STAFF_ID }),
      );

      const acknowledged = await withActor(() => nursingService.acknowledgeHandoffNote(note.id));
      expect(acknowledged.acknowledged).toBe(true);
      expect(acknowledged.acknowledgedBy).toBe(AUTHENTICATED_ACCOUNT);
      expect(acknowledged.acknowledgedAt).not.toBeNull();

      await expect(
        ctx.inTenant(() => nursingService.acknowledgeHandoffNote(note.id)),
      ).rejects.toThrow(ConflictException);
      await expect(
        ctx.inTenant(() => nursingService.acknowledgeHandoffNote('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });

    it('enforces ward-scoped access for a ward-assigned nurse', async () => {
      const admissionId = await makeAdmission(ctx, WARD_B);

      await expect(
        withWard(WARD_A, () => nursingService.createHandoffNote({ admissionId, note: 'x', createdBy: STAFF_ID })),
      ).rejects.toThrow(ForbiddenException);

      const note = await ctx.inTenant(() =>
        nursingService.createHandoffNote({ admissionId, note: 'x', createdBy: STAFF_ID }),
      );
      await expect(
        withWard(WARD_A, () => nursingService.acknowledgeHandoffNote(note.id)),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        withWard(WARD_A, () => nursingService.listHandoffNotes({ admissionId })),
      ).rejects.toThrow(ForbiddenException);

      // Unrestricted (no wardId) staff can still act on it.
      const acknowledged = await ctx.inTenant(() => nursingService.acknowledgeHandoffNote(note.id));
      expect(acknowledged.acknowledged).toBe(true);
    });

    it('enforces tenant isolation for handoff notes', async () => {
      const tenantB = await ctx.createTenant();
      const admissionId = await makeAdmission();
      const note = await ctx.inTenant(() =>
        nursingService.createHandoffNote({ admissionId, note: 'x', createdBy: STAFF_ID }),
      );

      const tenantBNotes = await tenantB.inTenant(() => nursingService.listHandoffNotes({}));
      expect(tenantBNotes.meta.total).toBe(0);
      await expect(
        tenantB.inTenant(() => nursingService.acknowledgeHandoffNote(note.id)),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
