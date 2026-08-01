import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { BillingSettingsService } from './billing-settings.service.js';
import { UpdateBillingSettingsDto } from './dto/update-billing-settings.dto.js';

@Controller('billing/settings')
@UseGuards(PermissionGuard)
export class BillingSettingsController {
  constructor(private readonly billingSettingsService: BillingSettingsService) {}

  @Get()
  @RequirePermission('master-data.manage')
  async get() {
    return this.billingSettingsService.get();
  }

  @Patch()
  @RequirePermission('master-data.manage')
  async update(@Body() dto: UpdateBillingSettingsDto) {
    return this.billingSettingsService.update(dto);
  }
}
