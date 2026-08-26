import { Module } from '@nestjs/common';
import { RequestContextFactory } from '@hospital/auth-guards';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsSubscriber } from './notifications.subscriber.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, RequestContextFactory, NotificationsSubscriber],
  exports: [NotificationsService],
})
export class NotificationsModule {}
