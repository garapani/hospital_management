import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { NursingService } from './nursing.service.js';
import { CreateAdministrationDto } from './dto/create-administration.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { ListAdministrationsQueryDto } from './dto/list-administrations.dto.js';
import { ListTasksQueryDto } from './dto/list-tasks.dto.js';
import { SkipAdministrationDto } from './dto/skip-administration.dto.js';

@Controller('nursing')
@UseGuards(PermissionGuard)
export class NursingController {
  constructor(private readonly nursingService: NursingService) {}

  // Tasks
  @Post('tasks')
  @RequirePermission('nursing.manage')
  async createTask(@Body() dto: CreateTaskDto) {
    return this.nursingService.createTask(dto);
  }

  @Get('tasks')
  @RequirePermission('nursing.read')
  async listTasks(@Query() query: ListTasksQueryDto) {
    return this.nursingService.listTasks(query);
  }

  @Post('tasks/:id/start')
  @RequirePermission('nursing.manage')
  async startTask(@Param('id') id: string) {
    return this.nursingService.startTask(id);
  }

  @Post('tasks/:id/complete')
  @RequirePermission('nursing.manage')
  async completeTask(@Param('id') id: string) {
    return this.nursingService.completeTask(id);
  }

  @Post('tasks/:id/cancel')
  @RequirePermission('nursing.manage')
  async cancelTask(@Param('id') id: string) {
    return this.nursingService.cancelTask(id);
  }

  // Medication administration (MAR)
  @Post('administrations')
  @RequirePermission('nursing.manage')
  async createAdministration(@Body() dto: CreateAdministrationDto) {
    return this.nursingService.createAdministration(dto);
  }

  @Get('administrations')
  @RequirePermission('nursing.read')
  async listAdministrations(@Query() query: ListAdministrationsQueryDto) {
    return this.nursingService.listAdministrations(query);
  }

  @Post('administrations/:id/administer')
  @RequirePermission('nursing.manage')
  async administer(@Param('id') id: string) {
    return this.nursingService.administer(id);
  }

  @Post('administrations/:id/skip')
  @RequirePermission('nursing.manage')
  async skipAdministration(@Param('id') id: string, @Body() dto: SkipAdministrationDto) {
    return this.nursingService.skipAdministration(id, dto.notes);
  }
}
