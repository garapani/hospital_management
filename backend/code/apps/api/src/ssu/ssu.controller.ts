import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { SsuService } from './ssu.service.js';
import { ApproveCaseDto } from './dto/approve-case.dto.js';
import { CreateCaseDto } from './dto/create-case.dto.js';
import { ListCasesQueryDto } from './dto/list-cases.dto.js';
import { RejectCaseDto } from './dto/reject-case.dto.js';

@Controller('ssu')
@UseGuards(PermissionGuard)
export class SsuController {
  constructor(private readonly ssuService: SsuService) {}

  @Post('cases')
  @RequirePermission('ssu.manage')
  async openCase(@Body() dto: CreateCaseDto) {
    return this.ssuService.openCase(dto);
  }

  @Get('cases')
  @RequirePermission('ssu.read')
  async listCases(@Query() query: ListCasesQueryDto) {
    return this.ssuService.listCases(query);
  }

  @Get('cases/:id')
  @RequirePermission('ssu.read')
  async getCase(@Param('id') id: string) {
    return this.ssuService.getCase(id);
  }

  @Post('cases/:id/approve')
  @RequirePermission('ssu.manage')
  async approveCase(@Param('id') id: string, @Body() dto: ApproveCaseDto) {
    return this.ssuService.approveCase(id, dto);
  }

  @Post('cases/:id/reject')
  @RequirePermission('ssu.manage')
  async rejectCase(@Param('id') id: string, @Body() dto: RejectCaseDto) {
    return this.ssuService.rejectCase(id, dto);
  }

  @Post('cases/:id/close')
  @RequirePermission('ssu.manage')
  async closeCase(@Param('id') id: string) {
    return this.ssuService.closeCase(id);
  }
}
