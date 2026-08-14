import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

const ACCOUNT_A = '00000000-0000-0000-0000-0000000000a1';
const ACCOUNT_B = '00000000-0000-0000-0000-0000000000b1';

describe('NotificationsService (integration)', () => {
  let ctx: TenantTestContext;
  let notificationsService: NotificationsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'notifications_svc' });
    notificationsService = new NotificationsService(ctx.tenantConnection);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('returns zero unread and no recent notifications for an account with none', async () => {
    await ctx.inTenant(async () => {
      const summary = await notificationsService.getSummary(ACCOUNT_A);
      expect(summary).toEqual({ unreadCount: 0, recentNotifications: [] });
    });
  });

  it('counts unread and lists only the requesting account\'s notifications, newest first', async () => {
    await ctx.inTenant(async () => {
      await notificationsService.create({ recipientAccountId: ACCOUNT_A, title: 'First', message: 'm1' });
      await notificationsService.create({ recipientAccountId: ACCOUNT_A, title: 'Second', message: 'm2' });
      await notificationsService.create({ recipientAccountId: ACCOUNT_B, title: 'Other account', message: 'm3' });

      const summary = await notificationsService.getSummary(ACCOUNT_A);
      expect(summary.unreadCount).toBe(2);
      expect(summary.recentNotifications.map((n) => n.title)).toEqual(['Second', 'First']);
      expect(summary.recentNotifications.every((n) => n.recipientAccountId === ACCOUNT_A)).toBe(true);
    });
  });

  it('paginates the full list for an account', async () => {
    await ctx.inTenant(async () => {
      const result = await notificationsService.list(ACCOUNT_A, { page: 1, limit: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(2);
      expect(result.meta.totalPages).toBe(2);
    });
  });

  it('marks a single notification as read, scoped to the owning account', async () => {
    await ctx.inTenant(async () => {
      const created = await notificationsService.create({
        recipientAccountId: ACCOUNT_A,
        title: 'To be read',
        message: 'm',
      });

      const marked = await notificationsService.markAsRead(created.id, ACCOUNT_A);
      expect(marked.isRead).toBe(true);

      await expect(notificationsService.markAsRead(created.id, ACCOUNT_B)).rejects.toThrow(NotFoundException);
    });
  });

  it('marks all of an account\'s unread notifications as read without touching other accounts', async () => {
    await ctx.inTenant(async () => {
      const accountC = '00000000-0000-0000-0000-0000000000c1';
      const accountD = '00000000-0000-0000-0000-0000000000d1';
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
      expect(summaryD.recentNotifications[0].id).toBe(otherAccountNotification.id);
    });
  });
});
