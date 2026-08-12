import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { CreatePharmacyDispensingDto } from './dto/create-pharmacy-dispensing.dto.js';
import { DispenseDrugDto } from './dto/dispense-drug.dto.js';
import { CancelPharmacyDispensingDto } from './dto/cancel-pharmacy-dispensing.dto.js';

@Controller('pharmacy/dispensings')
@UseGuards(PermissionGuard)
export class PharmacyDispensingController {
  constructor(private readonly pharmacyDispensingService: PharmacyDispensingService) {}

  @Post()
  @RequirePermission('pharmacy.dispensing.create')
  async create(@Body() dto: CreatePharmacyDispensingDto) {
    return this.pharmacyDispensingService.createDispensing(dto);
  }

  @Get()
  @RequirePermission('pharmacy.read')
  async listByOrderItem(@Query('orderItemId') orderItemId: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.pharmacyDispensingService.listByOrderItem({ orderItemId, page: pageNum, limit: limitNum });
  }

  @Get(':id')
  @RequirePermission('pharmacy.read')
  async findOne(@Param('id') id: string) {
    return this.pharmacyDispensingService.findOne(id);
  }

  @Patch(':id/dispense')
  @RequirePermission('pharmacy.dispensing.dispense')
  async dispense(@Param('id') id: string, @Body() dto: DispenseDrugDto) {
    return this.pharmacyDispensingService.dispenseDrug(id, dto);
  }

  @Patch(':id/cancel')
  @RequirePermission('pharmacy.dispensing.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelPharmacyDispensingDto) {
    return this.pharmacyDispensingService.cancel(id, dto.cancelReason);
  }
}
