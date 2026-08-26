import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { CreateRadiologyImagingTypeDto } from './dto/create-radiology-imaging-type.dto.js';
import { CreateRadiologyImagingItemDto } from './dto/create-radiology-imaging-item.dto.js';
import { UpdateRadiologyImagingItemDto } from './dto/update-radiology-imaging-item.dto.js';
import { UpdatePriceDto } from './dto/update-price.dto.js';

@Controller('radiology')
@UseGuards(PermissionGuard)
export class RadiologyCatalogController {
  constructor(private readonly radiologyCatalogService: RadiologyCatalogService) {}

  @Post('types')
  @RequirePermission('radiology.catalog.manage')
  async createType(@Body() dto: CreateRadiologyImagingTypeDto) {
    return this.radiologyCatalogService.createType(dto);
  }

  @Get('types')
  @RequirePermission('radiology.read')
  async listTypes() {
    return this.radiologyCatalogService.listTypes();
  }

  @Patch('types/:id/deactivate')
  @RequirePermission('radiology.catalog.manage')
  async deactivateType(@Param('id') id: string) {
    return this.radiologyCatalogService.deactivateType(id);
  }

  @Patch('types/:id/reactivate')
  @RequirePermission('radiology.catalog.manage')
  async reactivateType(@Param('id') id: string) {
    return this.radiologyCatalogService.reactivateType(id);
  }

  @Post('items')
  @RequirePermission('radiology.catalog.manage')
  async createItem(@Body() dto: CreateRadiologyImagingItemDto) {
    return this.radiologyCatalogService.createItem(dto);
  }

  @Get('types/:imagingTypeId/items')
  @RequirePermission('radiology.read')
  async listItemsByType(@Param('imagingTypeId') imagingTypeId: string) {
    return this.radiologyCatalogService.listItemsByType(imagingTypeId);
  }

  @Get('items/:id')
  @RequirePermission('radiology.read')
  async getItem(@Param('id') id: string) {
    return this.radiologyCatalogService.getItem(id);
  }

  @Patch('items/:id')
  @RequirePermission('radiology.catalog.manage')
  async updateItem(@Param('id') id: string, @Body() dto: UpdateRadiologyImagingItemDto) {
    return this.radiologyCatalogService.updateItem(id, dto);
  }

  @Patch('items/:id/price')
  @RequirePermission('radiology.catalog.manage')
  async updateItemPrice(@Param('id') id: string, @Body() dto: UpdatePriceDto) {
    return this.radiologyCatalogService.updateItemPrice(id, dto.price);
  }

  @Patch('items/:id/deactivate')
  @RequirePermission('radiology.catalog.manage')
  async deactivateItem(@Param('id') id: string) {
    return this.radiologyCatalogService.deactivateItem(id);
  }

  @Patch('items/:id/reactivate')
  @RequirePermission('radiology.catalog.manage')
  async reactivateItem(@Param('id') id: string) {
    return this.radiologyCatalogService.reactivateItem(id);
  }
}
