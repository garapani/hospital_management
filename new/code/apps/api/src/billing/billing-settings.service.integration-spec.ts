import { BillingSettingsService } from './billing-settings.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('BillingSettingsService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let billingSettingsService: BillingSettingsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'billing_settings_svc' });
    tenantB = await ctx.createTenant();
    billingSettingsService = new BillingSettingsService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('returns null before any settings are saved', async () => {
    const settings = await ctx.inTenant(() => billingSettingsService.get());
    expect(settings).toBeNull();
  });

  it('creates settings on first update', async () => {
    const settings = await ctx.inTenant(() =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital Pvt Ltd' }),
    );
    expect(settings.id).toBe('default');
    expect(settings.gstin).toBe('27AAAAA0000A1Z5');
    expect(settings.stateCode).toBe('27');
    expect(settings.hospitalLegalName).toBe('Test Hospital Pvt Ltd');
    // Backward-compatible: omitted defaultTaxPercent defaults to 0 (exempt).
    expect(settings.defaultTaxPercent).toBe(0);

    const fetched = await ctx.inTenant(() => billingSettingsService.get());
    expect(fetched?.gstin).toBe('27AAAAA0000A1Z5');
  });

  it('persists a configured defaultTaxPercent', async () => {
    const settings = await ctx.inTenant(() =>
      billingSettingsService.update({
        gstin: '27AAAAA0000A1Z5',
        stateCode: '27',
        hospitalLegalName: 'Test Hospital Pvt Ltd',
        defaultTaxPercent: 18,
      }),
    );
    expect(settings.defaultTaxPercent).toBe(18);

    const fetched = await ctx.inTenant(() => billingSettingsService.get());
    expect(fetched?.defaultTaxPercent).toBe(18);

    // A later update that omits it falls back to 0.
    const reset = await ctx.inTenant(() =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Renamed' }),
    );
    expect(reset.defaultTaxPercent).toBe(0);
  });

  it('overwrites settings on a second update instead of creating a duplicate row', async () => {
    await ctx.inTenant(() =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital Pvt Ltd' }),
    );
    const updated = await ctx.inTenant(() =>
      billingSettingsService.update({ gstin: '29BBBBB1111B2Z6', stateCode: '29', hospitalLegalName: 'Renamed Hospital Pvt Ltd' }),
    );
    expect(updated.id).toBe('default');
    expect(updated.gstin).toBe('29BBBBB1111B2Z6');

    const fetched = await ctx.inTenant(() => billingSettingsService.get());
    expect(fetched?.gstin).toBe('29BBBBB1111B2Z6');
  });

  it('enforces tenant isolation', async () => {
    await ctx.inTenant(() =>
      billingSettingsService.update({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Tenant 1 Hospital' }),
    );
    const tenant2Settings = await tenantB.inTenant(() => billingSettingsService.get());
    expect(tenant2Settings).toBeNull();
  });
});
