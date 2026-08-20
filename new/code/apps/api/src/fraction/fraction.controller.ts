import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { FractionService } from './fraction.service.js';
import {
  CreateEntryDto,
  CreateRuleDto,
  ListEntriesQueryDto,
  ListRulesQueryDto,
} from './dto/fraction.dto.js';

@Controller('fraction')
@UseGuards(PermissionGuard)
export class FractionController {
  constructor(private readonly fractionService: FractionService) {}

  @Post('rules')
  @RequirePermission('fraction.manage')
  async createRule(@Body() dto: CreateRuleDto) {
    return this.fractionService.createRule(dto);
  }

  @Get('rules')
  @RequirePermission('fraction.read')
  async listRules(@Query() query: ListRulesQueryDto) {
    return this.fractionService.listRules(query);
  }

  @Patch('rules/:id/deactivate')
  @RequirePermission('fraction.manage')
  async deactivateRule(@Param('id') id: string) {
    return this.fractionService.deactivateRule(id);
  }

  @Patch('rules/:id/reactivate')
  @RequirePermission('fraction.manage')
  async reactivateRule(@Param('id') id: string) {
    return this.fractionService.reactivateRule(id);
  }

  @Post('entries')
  @RequirePermission('fraction.manage')
  async recordEntry(@Body() dto: CreateEntryDto) {
    return this.fractionService.recordEntry(dto);
  }

  @Get('entries')
  @RequirePermission('fraction.read')
  async listEntries(@Query() query: ListEntriesQueryDto) {
    return this.fractionService.listEntries(query);
  }

  @Get('entries/:id')
  @RequirePermission('fraction.read')
  async getEntry(@Param('id') id: string) {
    return this.fractionService.getEntry(id);
  }
}
