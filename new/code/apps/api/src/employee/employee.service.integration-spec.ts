import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeService } from './employee.service.js';
import { EmployeeNumberGeneratorService } from './employee-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('EmployeeService (integration)', () => {
  let ctx: TenantTestContext;
  let employeeService: EmployeeService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'employee' });
    employeeService = new EmployeeService(
      ctx.tenantConnection,
      new EmployeeNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  let seq = 0;

  /** Inserts a department row directly — the service validates the reference via raw query only. */
  async function makeDepartment(tenant: TenantTestContext = ctx): Promise<string> {
    seq += 1;
    const rows = await tenant.inTenant(() =>
      tenant.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO departments ("departmentCode", "departmentName") VALUES ($1, $2) RETURNING id`,
          [`DEPT${seq}`, `Department ${seq}`],
        ),
      ),
    );
    return rows[0].id;
  }

  async function makeEmployee(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Rahul',
        lastName: `Sharma${seq}`,
        joinDate: '2024-01-15',
        phone: `99${String(seq).padStart(8, '0')}`,
        ...overrides,
      }),
    );
  }

  it('creates an employee with an auto-generated EMP code and defaults', async () => {
    const departmentId = await makeDepartment();
    const employee = await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Priya',
        lastName: 'Verma',
        departmentId,
        designation: 'Staff Nurse',
        phone: '9812345670',
        email: 'priya.verma@example.com',
        joinDate: '2023-06-01',
        employmentType: 'PartTime',
        monthlyBasicSalary: 25000,
      }),
    );
    expect(employee.employeeCode).toMatch(/^EMP-\d{4}-\d+$/);
    expect(employee.firstName).toBe('Priya');
    expect(employee.lastName).toBe('Verma');
    expect(employee.departmentId).toBe(departmentId);
    expect(employee.designation).toBe('Staff Nurse');
    expect(employee.phone).toBe('9812345670');
    expect(employee.email).toBe('priya.verma@example.com');
    expect(employee.joinDate).toBe('2023-06-01');
    expect(employee.employmentType).toBe('PartTime');
    expect(employee.monthlyBasicSalary).toBe(25000);
    expect(employee.isActive).toBe(true);

    // Defaults when optional fields are omitted.
    const minimal = await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Amit',
        lastName: 'Kumar',
        joinDate: '2025-02-10',
      }),
    );
    expect(minimal.employeeCode).toMatch(/^EMP-\d{4}-\d+$/);
    expect(minimal.employmentType).toBe('FullTime');
    expect(minimal.monthlyBasicSalary).toBe(0);
    expect(minimal.departmentId).toBeNull();
  });

  it('rejects a duplicate email or phone with ConflictException (P3)', async () => {
    await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Dup',
        lastName: 'Email',
        email: 'dup@example.com',
        phone: '9999999999',
        joinDate: '2025-01-01',
      }),
    );

    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({
          firstName: 'Other',
          lastName: 'Person',
          email: 'dup@example.com',
          joinDate: '2025-01-01',
        }),
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({
          firstName: 'Other',
          lastName: 'Person',
          phone: '9999999999',
          joinDate: '2025-01-01',
        }),
      ),
    ).rejects.toThrow(ConflictException);

    // Updating an employee onto an existing email is also rejected.
    const existing = await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Existing',
        lastName: 'Person',
        email: 'existing@example.com',
        joinDate: '2025-01-01',
      }),
    );
    await expect(
      ctx.inTenant(() =>
        employeeService.updateEmployee(existing.id, { email: 'dup@example.com' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('generates sequential, unique employee codes', async () => {
    const a = await makeEmployee();
    const b = await makeEmployee();
    expect(a.employeeCode).toMatch(/^EMP-\d{4}-\d+$/);
    expect(b.employeeCode).toMatch(/^EMP-\d{4}-\d+$/);
    expect(a.employeeCode).not.toBe(b.employeeCode);
  });

  it('rejects an unknown department with NotFoundException', async () => {
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({
          firstName: 'Sita',
          lastName: 'Rao',
          joinDate: '2024-03-01',
          departmentId: '00000000-0000-0000-0000-000000000000',
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('validates create inputs with BadRequestException', async () => {
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({ firstName: '   ', lastName: 'X', joinDate: '2024-01-01' }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({ firstName: 'X', lastName: '', joinDate: '2024-01-01' }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({ firstName: 'X', lastName: 'Y', joinDate: '   ' }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({
          firstName: 'X',
          lastName: 'Y',
          joinDate: '2024-01-01',
          employmentType: 'Casual' as never,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({
          firstName: 'X',
          lastName: 'Y',
          joinDate: '2024-01-01',
          monthlyBasicSalary: -1,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        employeeService.createEmployee({ firstName: 'X', lastName: 'Y', joinDate: 'not-a-date' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates master fields with a partial PATCH', async () => {
    const employee = await makeEmployee();

    const updated = await ctx.inTenant(() =>
      employeeService.updateEmployee(employee.id, {
        designation: 'Head Nurse',
        monthlyBasicSalary: 45000,
        employmentType: 'Contract',
      }),
    );
    expect(updated.designation).toBe('Head Nurse');
    expect(updated.monthlyBasicSalary).toBe(45000);
    expect(updated.employmentType).toBe('Contract');
    // Untouched fields survive the PATCH.
    expect(updated.firstName).toBe(employee.firstName);
    expect(updated.lastName).toBe(employee.lastName);

    // Update validation mirrors create.
    await expect(
      ctx.inTenant(() =>
        employeeService.updateEmployee(employee.id, { employmentType: 'Intern' as never }),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => employeeService.updateEmployee(employee.id, { monthlyBasicSalary: -5 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => employeeService.updateEmployee(employee.id, { firstName: '  ' })),
    ).rejects.toThrow(BadRequestException);

    // Unknown id -> NotFound.
    await expect(
      ctx.inTenant(() =>
        employeeService.updateEmployee('00000000-0000-0000-0000-000000000000', {
          firstName: 'A',
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes and reactivates, rejecting a double deactivate', async () => {
    const employee = await makeEmployee();

    const deactivated = await ctx.inTenant(() => employeeService.deactivateEmployee(employee.id));
    expect(deactivated.isActive).toBe(false);

    // Double deactivate -> ConflictException.
    await expect(
      ctx.inTenant(() => employeeService.deactivateEmployee(employee.id)),
    ).rejects.toThrow(ConflictException);

    // Soft-deleted rows stay visible via get/list (§28).
    const fetched = await ctx.inTenant(() => employeeService.getEmployee(employee.id));
    expect(fetched.isActive).toBe(false);

    const reactivated = await ctx.inTenant(() => employeeService.reactivateEmployee(employee.id));
    expect(reactivated.isActive).toBe(true);

    await expect(
      ctx.inTenant(() =>
        employeeService.deactivateEmployee('00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      ctx.inTenant(() =>
        employeeService.reactivateEmployee('00000000-0000-0000-0000-000000000000'),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists employees paginated and filterable by department, type, and free-text search', async () => {
    const departmentA = await makeDepartment();
    const departmentB = await makeDepartment();
    await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Neha',
        lastName: 'Gupta',
        departmentId: departmentA,
        employmentType: 'FullTime',
        phone: '9876543210',
        email: 'neha.gupta@example.com',
        joinDate: '2022-05-01',
      }),
    );
    await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Vikram',
        lastName: 'Singh',
        departmentId: departmentB,
        employmentType: 'PartTime',
        phone: '9123456780',
        joinDate: '2024-08-15',
      }),
    );
    await ctx.inTenant(() =>
      employeeService.createEmployee({
        firstName: 'Anjali',
        lastName: 'Mehta',
        departmentId: departmentA,
        employmentType: 'Contract',
        joinDate: '2025-01-05',
      }),
    );

    const byDepartment = await ctx.inTenant(() =>
      employeeService.listEmployees({ departmentId: departmentA }),
    );
    expect(byDepartment.meta.total).toBe(2);
    expect(byDepartment.data.every((e) => e.departmentId === departmentA)).toBe(true);

    const byType = await ctx.inTenant(() =>
      employeeService.listEmployees({ employmentType: 'PartTime' }),
    );
    expect(byType.meta.total).toBeGreaterThanOrEqual(1);
    expect(byType.data.every((e) => e.employmentType === 'PartTime')).toBe(true);

    // Combined filters narrow to exactly the Vikram row.
    const byDepartmentAndType = await ctx.inTenant(() =>
      employeeService.listEmployees({ departmentId: departmentB, employmentType: 'PartTime' }),
    );
    expect(byDepartmentAndType.meta.total).toBe(1);
    expect(byDepartmentAndType.data[0].lastName).toBe('Singh');

    const byQ = await ctx.inTenant(() => employeeService.listEmployees({ q: 'neha' }));
    expect(byQ.meta.total).toBeGreaterThanOrEqual(1);
    expect(byQ.data.some((e) => e.firstName === 'Neha')).toBe(true);

    const byQEmail = await ctx.inTenant(() => employeeService.listEmployees({ q: 'neha.gupta' }));
    expect(byQEmail.meta.total).toBe(1);

    const page = await ctx.inTenant(() =>
      employeeService.listEmployees({ departmentId: departmentA, page: 1, limit: 1 }),
    );
    expect(page.meta.page).toBe(1);
    expect(page.meta.limit).toBe(1);
    expect(page.meta.total).toBe(2);
    expect(page.data).toHaveLength(1);
  });

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const employee = await makeEmployee();

    // Tenant B sees none of tenant A's records.
    const tenantBEmployees = await tenantB.inTenant(() => employeeService.listEmployees({}));
    expect(tenantBEmployees.meta.total).toBe(0);

    // Tenant B cannot read or act on tenant A's rows.
    await expect(tenantB.inTenant(() => employeeService.getEmployee(employee.id))).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      tenantB.inTenant(() =>
        employeeService.updateEmployee(employee.id, { designation: 'Hacked' }),
      ),
    ).rejects.toThrow(NotFoundException);
    await expect(
      tenantB.inTenant(() => employeeService.deactivateEmployee(employee.id)),
    ).rejects.toThrow(NotFoundException);

    // Tenant A is untouched by tenant B's activity.
    const employees = await ctx.inTenant(() => employeeService.listEmployees({}));
    expect(employees.meta.total).toBeGreaterThanOrEqual(1);
  });
});
