import { IsIn, IsOptional, IsString, IsUUID} from 'class-validator';

import type { NotificationType } from '../entities/notification.entity.js';

const NOTIFICATION_TYPES = ['info', 'warning', 'error', 'success'] as const;

export class CreateNotificationDto {
  @IsUUID()

  recipientAccountId!: string;

  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;

  @IsOptional()
  @IsString()
  link?: string;
}
