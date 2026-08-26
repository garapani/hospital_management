import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { SubscriptionBillingService } from './subscription-billing.service.js';
import { SubscribeTenantDto } from './dto/subscribe-tenant.dto.js';

// Platform-only: this is the SaaS vendor's own billing for hospital subscriptions — never
// reachable from a hospital tenant. Same permission as tenant management.
const REQUIRED_PERMISSION = 'system-admin.tenants.manage';

@Controller('platform/billing')
@UseGuards(PermissionGuard)
export class PlatformBillingController {
  constructor(private readonly billingService: SubscriptionBillingService) {}

  @Get('subscriptions')
  @RequirePermission(REQUIRED_PERMISSION)
  listSubscriptions() {
    return this.billingService.listSubscriptions();
  }

  @Get('tenants/:hospitalId/subscription')
  @RequirePermission(REQUIRED_PERMISSION)
  async getSubscription(@Param('hospitalId') hospitalId: string) {
    return this.billingService.getSubscription(hospitalId);
  }

  @Post('tenants/:hospitalId/subscribe')
  @RequirePermission(REQUIRED_PERMISSION)
  async subscribe(
    @Param('hospitalId') hospitalId: string,
    @Body() body: SubscribeTenantDto,
  ) {
    return this.billingService.subscribe(hospitalId, body.billingCycle);
  }

  @Post('tenants/:hospitalId/cancel')
  @RequirePermission(REQUIRED_PERMISSION)
  async cancel(@Param('hospitalId') hospitalId: string) {
    return this.billingService.cancelSubscription(hospitalId);
  }

  @Post('tenants/:hospitalId/invoices')
  @RequirePermission(REQUIRED_PERMISSION)
  async issueInvoice(@Param('hospitalId') hospitalId: string) {
    return this.billingService.issueInvoice(hospitalId);
  }

  @Get('tenants/:hospitalId/invoices')
  @RequirePermission(REQUIRED_PERMISSION)
  listInvoices(@Param('hospitalId') hospitalId: string) {
    return this.billingService.listInvoices(hospitalId);
  }

  @Post('invoices/:invoiceId/paid')
  @RequirePermission(REQUIRED_PERMISSION)
  async markPaid(@Param('invoiceId') invoiceId: string) {
    return this.billingService.markInvoicePaid(invoiceId);
  }
}
