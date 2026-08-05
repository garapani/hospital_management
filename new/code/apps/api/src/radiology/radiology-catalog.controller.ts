import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { CreateRadiologyImagingTypeDto } from './dto/create-radiology-imaging-type.dto.js';
import { CreateRadiologyImagingItemDto } from './dto/create-radiology-imaging-item.dto.js';

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
}
