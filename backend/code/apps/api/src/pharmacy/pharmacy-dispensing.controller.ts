import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { CreatePharmacyDispensingDto } from './dto/create-pharmacy-dispensing.dto.js';
import { DispenseDrugDto } from './dto/dispense-drug.dto.js';
import { CancelPharmacyDispensingDto } from './dto/cancel-pharmacy-dispensing.dto.js';
import { ReversePharmacyDispensingDto } from './dto/reverse-pharmacy-dispensing.dto.js';
import { ListPharmacyDispensingDto } from './dto/list-pharmacy-dispensing.dto.js';
import { ListPendingPharmacyItemsDto } from './dto/list-pending-pharmacy-items.dto.js';

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
  async findAll(@Query() query: ListPharmacyDispensingDto) {
    return this.pharmacyDispensingService.findAll(query);
  }

  // Must precede @Get(':id') so the literal 'pending-items' segment isn't swallowed by the :id param.
  @Get('pending-items')
  @RequirePermission('pharmacy.read')
  async findPendingItems(@Query() query: ListPendingPharmacyItemsDto) {
    return this.pharmacyDispensingService.listPendingItems(query);
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

  @Patch(':id/reverse')
  @RequirePermission('pharmacy.dispensing.dispense')
  async reverse(@Param('id') id: string, @Body() dto: ReversePharmacyDispensingDto) {
    return this.pharmacyDispensingService.reverseDispensing(id, { reversalReason: dto.reversalReason });
  }
}
