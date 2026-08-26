import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { CreateInventoryItemCategoryDto } from './dto/create-inventory-item-category.dto.js';
import { CreateInventoryItemSubCategoryDto } from './dto/create-inventory-item-sub-category.dto.js';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto.js';
import { CreateInventoryVendorDto } from './dto/create-inventory-vendor.dto.js';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';
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

  @Patch('items/:id')
  @RequirePermission('inventory.catalog.manage')
  async updateItem(@Param('id') id: string, @Body() dto: UpdateInventoryItemDto) {
    return this.inventoryCatalogService.updateItem(id, dto);
  }

  @Patch('items/:id/deactivate')
  @RequirePermission('inventory.catalog.manage')
  async deactivateItem(@Param('id') id: string) {
    return this.inventoryCatalogService.deactivateItem(id);
  }

  @Patch('items/:id/reactivate')
  @RequirePermission('inventory.catalog.manage')
  async reactivateItem(@Param('id') id: string) {
    return this.inventoryCatalogService.reactivateItem(id);
  }

  @Patch('categories/:id/deactivate')
  @RequirePermission('inventory.catalog.manage')
  async deactivateCategory(@Param('id') id: string) {
    return this.inventoryCatalogService.deactivateCategory(id);
  }

  @Patch('categories/:id/reactivate')
  @RequirePermission('inventory.catalog.manage')
  async reactivateCategory(@Param('id') id: string) {
    return this.inventoryCatalogService.reactivateCategory(id);
  }

  @Patch('sub-categories/:id/deactivate')
  @RequirePermission('inventory.catalog.manage')
  async deactivateSubCategory(@Param('id') id: string) {
    return this.inventoryCatalogService.deactivateSubCategory(id);
  }

  @Patch('sub-categories/:id/reactivate')
  @RequirePermission('inventory.catalog.manage')
  async reactivateSubCategory(@Param('id') id: string) {
    return this.inventoryCatalogService.reactivateSubCategory(id);
  }

  @Patch('vendors/:id/deactivate')
  @RequirePermission('inventory.catalog.manage')
  async deactivateVendor(@Param('id') id: string) {
    return this.inventoryCatalogService.deactivateVendor(id);
  }

  @Patch('vendors/:id/reactivate')
  @RequirePermission('inventory.catalog.manage')
  async reactivateVendor(@Param('id') id: string) {
    return this.inventoryCatalogService.reactivateVendor(id);
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
