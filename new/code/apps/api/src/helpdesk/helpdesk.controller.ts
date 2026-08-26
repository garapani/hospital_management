import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { HelpdeskService } from './helpdesk.service.js';
import { AssignTicketDto } from './dto/assign-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsQueryDto } from './dto/list-tickets.dto.js';

@Controller('helpdesk')
@UseGuards(PermissionGuard)
export class HelpdeskController {
  constructor(private readonly helpdeskService: HelpdeskService) {}

  @Post('tickets')
  @RequirePermission('helpdesk.create')
  async createTicket(@Body() dto: CreateTicketDto) {
    return this.helpdeskService.createTicket(dto);
  }

  @Get('tickets')
  @RequirePermission('helpdesk.read')
  async listTickets(@Query() query: ListTicketsQueryDto) {
    return this.helpdeskService.listTickets(query);
  }

  @Get('tickets/:id')
  @RequirePermission('helpdesk.read')
  async getTicket(@Param('id') id: string) {
    return this.helpdeskService.getTicket(id);
  }

  @Post('tickets/:id/assign')
  @RequirePermission('helpdesk.manage')
  async assignTicket(@Param('id') id: string, @Body() dto: AssignTicketDto) {
    return this.helpdeskService.assignTicket(id, dto.assigneeAccountId);
  }

  @Post('tickets/:id/start')
  @RequirePermission('helpdesk.manage')
  async startTicket(@Param('id') id: string) {
    return this.helpdeskService.startTicket(id);
  }

  @Post('tickets/:id/resolve')
  @RequirePermission('helpdesk.manage')
  async resolveTicket(@Param('id') id: string) {
    return this.helpdeskService.resolveTicket(id);
  }

  @Post('tickets/:id/close')
  @RequirePermission('helpdesk.manage')
  async closeTicket(@Param('id') id: string) {
    return this.helpdeskService.closeTicket(id);
  }
}
