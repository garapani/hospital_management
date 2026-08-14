import { Controller, Get, Query, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PermissionGuard, RequestContextFactory } from '@hospital/auth-guards';
import { NotificationsService } from './notifications.service.js';
import { SearchNotificationsDto } from './dto/search-notifications.dto.js';

@Controller('notifications')
@UseGuards(PermissionGuard)
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
