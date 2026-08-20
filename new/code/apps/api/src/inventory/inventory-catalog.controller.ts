import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { CreateInventoryItemCategoryDto } from './dto/create-inventory-item-category.dto.js';
import { CreateInventoryItemSubCategoryDto } from './dto/create-inventory-item-sub-category.dto.js';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto.js';
import { CreateInventoryVendorDto } from './dto/create-inventory-vendor.dto.js';
import { UpdatePriceDto } from './dto/update-price.dto.js';

@Controller('inventory')
@UseGuards(PermissionGuard)
export class InventoryCatalogController {
  constructor(private readonly inventoryCatalogService: InventoryCatalogService) {}

  @Post('categories')
  @RequirePermission('inventory.catalog.manage')
  async createCategory(@Body() dto: CreateInventoryItemCategoryDto) {
    return this.inventoryCatalogService.createCategory(dto);
  }

  @Get('categories')
  @RequirePermission('inventory.read')
  async listCategories() {
    return this.inventoryCatalogService.listCategories();
  }

  @Post('sub-categories')
  @RequirePermission('inventory.catalog.manage')
  async createSubCategory(@Body() dto: CreateInventoryItemSubCategoryDto) {
    return this.inventoryCatalogService.createSubCategory(dto);
  }

  @Get('categories/:categoryId/sub-categories')
  @RequirePermission('inventory.read')
  async listSubCategoriesByCategory(@Param('categoryId') categoryId: string) {
    return this.inventoryCatalogService.listSubCategoriesByCategory(categoryId);
  }

  @Post('items')
  @RequirePermission('inventory.catalog.manage')
  async createItem(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryCatalogService.createItem(dto);
  }

  @Get('sub-categories/:subCategoryId/items')
  @RequirePermission('inventory.read')
  async listItemsBySubCategory(@Param('subCategoryId') subCategoryId: string) {
    return this.inventoryCatalogService.listItemsBySubCategory(subCategoryId);
  }

  @Get('items/:id')
  @RequirePermission('inventory.read')
  async getItem(@Param('id') id: string) {
    return this.inventoryCatalogService.getItem(id);
  }

  @Patch('items/:id/price')
  @RequirePermission('inventory.catalog.manage')
  async updateItemSalePrice(@Param('id') id: string, @Body() dto: UpdatePriceDto) {
    return this.inventoryCatalogService.updateItemSalePrice(id, dto.price);
  }

  @Post('vendors')
  @RequirePermission('inventory.catalog.manage')
  async createVendor(@Body() dto: CreateInventoryVendorDto) {
    return this.inventoryCatalogService.createVendor(dto);
  }

  @Get('vendors')
  @RequirePermission('inventory.read')
  async listVendors() {
    return this.inventoryCatalogService.listVendors();
  }

  @Get('vendors/:id')
  @RequirePermission('inventory.read')
  async getVendor(@Param('id') id: string) {
    return this.inventoryCatalogService.getVendor(id);
  }
}
