import { NotificationType } from '../entities/notification.entity.js';

export class CreateNotificationDto {
  recipientAccountId!: string;
  title!: string;
  message!: string;
  type?: NotificationType;
  link?: string;
}
