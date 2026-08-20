import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PaginationQueryDto } from '@hospital/pagination';
import { InsuranceClaimsService } from './insurance-claims.service.js';
import {
  ApproveClaimDto,
  CheckCoverageQueryDto,
  CreateClaimDto,
  CreatePayerDto,
  CreatePolicyDto,
  ListClaimsQueryDto,
  RejectClaimDto,
  UpdatePayerDto,
  UpdatePolicyDto,
} from './dto/insurance.dto.js';

@Controller('insurance')
@UseGuards(PermissionGuard)
export class InsuranceController {
  constructor(private readonly insuranceClaimsService: InsuranceClaimsService) {}

  // Payers
  @Post('payers')
  @RequirePermission('insurance.manage')
  async createPayer(@Body() dto: CreatePayerDto) {
    return this.insuranceClaimsService.createPayer(dto);
  }

  @Get('payers')
  @RequirePermission('insurance.read')
  async listPayers() {
    return this.insuranceClaimsService.listPayers();
  }

  @Patch('payers/:id')
  @RequirePermission('insurance.manage')
  async updatePayer(@Param('id') id: string, @Body() dto: UpdatePayerDto) {
    return this.insuranceClaimsService.updatePayer(id, dto);
  }

  @Patch('payers/:id/deactivate')
  @RequirePermission('insurance.manage')
  async deactivatePayer(@Param('id') id: string) {
    return this.insuranceClaimsService.deactivatePayer(id);
  }

  @Patch('payers/:id/reactivate')
  @RequirePermission('insurance.manage')
  async reactivatePayer(@Param('id') id: string) {
    return this.insuranceClaimsService.reactivatePayer(id);
  }

  // Policies
  @Post('policies')
  @RequirePermission('insurance.manage')
  async createPolicy(@Body() dto: CreatePolicyDto) {
    return this.insuranceClaimsService.createPolicy(dto);
  }

  @Get('policies')
  @RequirePermission('insurance.read')
  async listPolicies(@Query() query: PaginationQueryDto & { patientId?: string }) {
    return this.insuranceClaimsService.listPolicies(query);
  }

  @Get('policies/:id')
  @RequirePermission('insurance.read')
  async getPolicy(@Param('id') id: string) {
    return this.insuranceClaimsService.getPolicy(id);
  }

  @Get('policies/:id/coverage')
  @RequirePermission('insurance.read')
  async checkCoverage(@Param('id') id: string, @Query() query: CheckCoverageQueryDto) {
    return this.insuranceClaimsService.checkCoverage(id, query.date);
  }

  @Patch('policies/:id')
  @RequirePermission('insurance.manage')
  async updatePolicy(@Param('id') id: string, @Body() dto: UpdatePolicyDto) {
    return this.insuranceClaimsService.updatePolicy(id, dto);
  }

  @Patch('policies/:id/deactivate')
  @RequirePermission('insurance.manage')
  async deactivatePolicy(@Param('id') id: string) {
    return this.insuranceClaimsService.deactivatePolicy(id);
  }

  @Patch('policies/:id/reactivate')
  @RequirePermission('insurance.manage')
  async reactivatePolicy(@Param('id') id: string) {
    return this.insuranceClaimsService.reactivatePolicy(id);
  }

  // Claims
  @Post('claims')
  @RequirePermission('insurance.manage')
  async createClaim(@Body() dto: CreateClaimDto) {
    return this.insuranceClaimsService.createClaim(dto);
  }

  @Get('claims')
  @RequirePermission('insurance.read')
  async listClaims(@Query() query: ListClaimsQueryDto) {
    return this.insuranceClaimsService.listClaims(query);
  }

  @Get('claims/:id')
  @RequirePermission('insurance.read')
  async getClaim(@Param('id') id: string) {
    return this.insuranceClaimsService.getClaim(id);
  }

  @Post('claims/:id/submit')
  @RequirePermission('insurance.manage')
  async submitClaim(@Param('id') id: string) {
    return this.insuranceClaimsService.submitClaim(id);
  }

  @Post('claims/:id/approve')
  @RequirePermission('insurance.manage')
  async approveClaim(@Param('id') id: string, @Body() dto: ApproveClaimDto) {
    return this.insuranceClaimsService.approveClaim(id, dto.amountApproved);
  }

  @Post('claims/:id/reject')
  @RequirePermission('insurance.manage')
  async rejectClaim(@Param('id') id: string, @Body() dto: RejectClaimDto) {
    return this.insuranceClaimsService.rejectClaim(id, dto.remarks);
  }

  @Post('claims/:id/pay')
  @RequirePermission('insurance.manage')
  async markClaimPaid(@Param('id') id: string) {
    return this.insuranceClaimsService.markClaimPaid(id);
  }
}
