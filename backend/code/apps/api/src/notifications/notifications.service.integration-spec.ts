import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { Account } from '../accounts/entities/account.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('NotificationsService (integration)', () => {
  let ctx: TenantTestContext;
  let notificationsService: NotificationsService;

  async function createAccount(overrides: Partial<Account> = {}): Promise<string> {
    const account = await ctx.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).save(
        manager.getRepository(Account).create({
          accountType: 'staff',
          displayName: 'Test Account',
          isActive: true,
          ...overrides,
        }),
      ),
    );
    return account.id;
  }

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'notifications_svc' });
    notificationsService = new NotificationsService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('returns zero unread and no recent notifications for an account with none', async () => {
    await ctx.inTenant(async () => {
      const accountId = await createAccount();
      const summary = await notificationsService.getSummary(accountId);
      expect(summary).toEqual({ unreadCount: 0, recentNotifications: [] });
    });
  });

  it('counts unread and lists only the requesting account\'s notifications, newest first', async () => {
    await ctx.inTenant(async () => {
      const accountA = await createAccount();
      const accountB = await createAccount();
      await notificationsService.create({ recipientAccountId: accountA, title: 'First', message: 'm1' });
      await notificationsService.create({ recipientAccountId: accountA, title: 'Second', message: 'm2' });
      await notificationsService.create({ recipientAccountId: accountB, title: 'Other account', message: 'm3' });

      const summary = await notificationsService.getSummary(accountA);
      expect(summary.unreadCount).toBe(2);
      expect(summary.recentNotifications.map((n) => n.title)).toEqual(['Second', 'First']);
      expect(summary.recentNotifications.every((n) => n.recipientAccountId === accountA)).toBe(true);
    });
  });

  it('paginates the full list for an account', async () => {
    await ctx.inTenant(async () => {
      const accountA = await createAccount();
      await notificationsService.create({ recipientAccountId: accountA, title: 'First', message: 'm1' });
      await notificationsService.create({ recipientAccountId: accountA, title: 'Second', message: 'm2' });

      const result = await notificationsService.list(accountA, { page: 1, limit: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(2);
    });
  });

  it('marks a single notification as read, scoped to the owning account', async () => {
    await ctx.inTenant(async () => {
      const accountA = await createAccount();
      const accountB = await createAccount();
      const created = await notificationsService.create({
        recipientAccountId: accountA,
        title: 'To be read',
        message: 'm',
      });

      const marked = await notificationsService.markAsRead(created!.id, accountA);
      expect(marked.isRead).toBe(true);

      await expect(notificationsService.markAsRead(created!.id, accountB)).rejects.toThrow(NotFoundException);
    });
  });

  it('marks all of an account\'s unread notifications as read without touching other accounts', async () => {
    await ctx.inTenant(async () => {
      const accountC = await createAccount();
      const accountD = await createAccount();
      await notificationsService.create({ recipientAccountId: accountC, title: 'Bulk 1', message: 'm' });
      await notificationsService.create({ recipientAccountId: accountC, title: 'Bulk 2', message: 'm' });
      const otherAccountNotification = await notificationsService.create({
        recipientAccountId: accountD,
        title: 'Untouched',
        message: 'm',
      });

      await notificationsService.markAllAsRead(accountC);

      const summaryC = await notificationsService.getSummary(accountC);
      expect(summaryC.unreadCount).toBe(0);

      const summaryD = await notificationsService.getSummary(accountD);
      expect(summaryD.unreadCount).toBe(1);
      expect(summaryD.recentNotifications[0].id).toBe(otherAccountNotification!.id);
    });
  });

  it('drops the notification and returns null when the recipient account does not exist', async () => {
    await ctx.inTenant(async () => {
      const bogusAccountId = '00000000-0000-0000-0000-0000000000ff';
      const result = await notificationsService.create({
        recipientAccountId: bogusAccountId,
        title: 'Nobody home',
        message: 'm',
      });
      expect(result).toBeNull();

      const summary = await notificationsService.getSummary(bogusAccountId);
      expect(summary).toEqual({ unreadCount: 0, recentNotifications: [] });
    });
  });

  it('drops the notification and returns null when the recipient account is deactivated', async () => {
    await ctx.inTenant(async () => {
      const deactivatedAccountId = await createAccount({ isActive: false });
      const result = await notificationsService.create({
        recipientAccountId: deactivatedAccountId,
        title: 'No longer here',
        message: 'm',
      });
      expect(result).toBeNull();
    });
  });
});
