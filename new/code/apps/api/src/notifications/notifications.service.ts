import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Account } from '../accounts/entities/account.entity.js';
import { Notification } from './entities/notification.entity.js';
import { CreateNotificationDto } from './dto/create-notification.dto.js';
import { SearchNotificationsDto } from './dto/search-notifications.dto.js';

const RECENT_NOTIFICATIONS_LIMIT = 5;

export interface NotificationSummary {
  unreadCount: number;
  recentNotifications: Notification[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly tenantConnection: TenantConnectionService) {}

  /**
   * Producers (e.g. NotificationsSubscriber) pass a recipient id sourced from unvalidated,
   * client-supplied fields (Admission.admittingDoctorId, Appointment.doctorId) with no FK to
   * `accounts` anywhere in the schema. Without this check a bad id silently persists a
   * notification no JWT-authenticated read (all of which filter by the caller's real accountId)
   * can ever match — the row exists but is permanently unreachable. Returns null instead of
   * inserting that dead row, so the caller can log the drop rather than fail the write it rode in on.
   */
  async create(dto: CreateNotificationDto): Promise<Notification | null> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const recipient = await manager
        .getRepository(Account)
        .findOne({ where: { id: dto.recipientAccountId } });
      if (!recipient || !recipient.isActive) {
        this.logger.warn(
          `Dropping notification "${dto.title}": recipient account ${dto.recipientAccountId} ${
            recipient ? 'is deactivated' : 'does not exist'
          }`,
        );
        return null;
      }

      const repository = manager.getRepository(Notification);
      const notification = repository.create({
        recipientAccountId: dto.recipientAccountId,
        title: dto.title,
        message: dto.message,
        type: dto.type ?? 'info',
        link: dto.link ?? null,
      });
      return repository.save(notification);
    });
  }

  async getSummary(accountId: string): Promise<NotificationSummary> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Notification);
      const [unreadCount, recentNotifications] = await Promise.all([
        repository.count({ where: { recipientAccountId: accountId, isRead: false } }),
        repository.find({
          where: { recipientAccountId: accountId },
          order: { createdAt: 'DESC' },
          take: RECENT_NOTIFICATIONS_LIMIT,
        }),
      ]);
      return { unreadCount, recentNotifications };
    });
  }

  async list(accountId: string, query: SearchNotificationsDto): Promise<PaginatedResponseDto<Notification>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .getRepository(Notification)
        .createQueryBuilder('notification')
        .where('notification.recipientAccountId = :accountId', { accountId })
        .orderBy('notification.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async markAsRead(id: string, accountId: string): Promise<Notification> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Notification);
      const notification = await repository.findOne({ where: { id, recipientAccountId: accountId } });
      if (!notification) {
        throw new NotFoundException(`Notification ${id} not found`);
      }
      if (!notification.isRead) {
        notification.isRead = true;
        await repository.save(notification);
      }
      return notification;
    });
  }

  async markAllAsRead(accountId: string): Promise<void> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await manager
        .getRepository(Notification)
        .createQueryBuilder()
        .update(Notification)
        .set({ isRead: true })
        .where('recipientAccountId = :accountId AND isRead = false', { accountId })
        .execute();
    });
  }
}
