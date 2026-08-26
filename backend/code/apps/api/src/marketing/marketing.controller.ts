import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { MarketingService } from './marketing.service.js';
import { CreateSourceDto, ListReferralsQueryDto, RecordReferralDto } from './dto/marketing.dto.js';

@Controller('marketing')
@UseGuards(PermissionGuard)
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  // Referral sources
  @Post('sources')
  @RequirePermission('marketing.manage')
  async createSource(@Body() dto: CreateSourceDto) {
    return this.marketingService.createSource(dto);
  }

  @Get('sources')
  @RequirePermission('marketing.read')
  async listSources() {
    return this.marketingService.listSources();
  }

  @Patch('sources/:id/deactivate')
  @RequirePermission('marketing.manage')
  async deactivateSource(@Param('id') id: string) {
    return this.marketingService.deactivateSource(id);
  }

  @Patch('sources/:id/reactivate')
  @RequirePermission('marketing.manage')
  async reactivateSource(@Param('id') id: string) {
    return this.marketingService.reactivateSource(id);
  }

  // Patient referrals
  @Post('referrals')
  @RequirePermission('marketing.create')
  async recordReferral(@Body() dto: RecordReferralDto) {
    return this.marketingService.recordReferral(dto);
  }

  @Get('referrals')
  @RequirePermission('marketing.read')
  async listReferrals(@Query() query: ListReferralsQueryDto) {
    return this.marketingService.listReferrals(query);
  }

  @Get('referrals/:id')
  @RequirePermission('marketing.read')
  async getReferral(@Param('id') id: string) {
    return this.marketingService.getReferral(id);
  }
}
