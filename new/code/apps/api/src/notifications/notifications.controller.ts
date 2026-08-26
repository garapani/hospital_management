import { Controller, Get, Query, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PermissionGuard, RequestContextFactory, RequirePermission } from '@hospital/auth-guards';
import { NotificationsService } from './notifications.service.js';
import { SearchNotificationsDto } from './dto/search-notifications.dto.js';

// Class-level: every endpoint is self-scoped (the caller only ever reads/marks their OWN
// notifications), so one gate covers the controller — the guard honors class-level metadata
// (rbac P2 fix). The permission is granted to every catalog role; it exists to make the gate
// real (the controller previously had a decorative PermissionGuard with no requirement).
@Controller('notifications')
@UseGuards(PermissionGuard)
@RequirePermission('notification.read')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly requestContextFactory: RequestContextFactory,
  ) {}

  @Get('summary')
  async getSummary(@Req() req: Request) {
    const { accountId } = this.requestContextFactory.fromRequest(req);
    return this.notificationsService.getSummary(accountId as string);
  }

  @Get()
  async list(@Query() query: SearchNotificationsDto, @Req() req: Request) {
    const { accountId } = this.requestContextFactory.fromRequest(req);
    return this.notificationsService.list(accountId as string, query);
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req: Request) {
    const { accountId } = this.requestContextFactory.fromRequest(req);
    return this.notificationsService.markAsRead(id, accountId as string);
  }

  @Post('mark-all-read')
  async markAllAsRead(@Req() req: Request) {
    const { accountId } = this.requestContextFactory.fromRequest(req);
    await this.notificationsService.markAllAsRead(accountId as string);
    return { success: true };
  }
}
