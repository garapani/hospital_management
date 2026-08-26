import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { FixedAssetsService } from './fixed-assets.service.js';
import { CreateFixedAssetCategoryDto } from './dto/create-fixed-asset-category.dto.js';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto.js';
import { ListDepreciationEntriesQueryDto } from './dto/list-depreciation-entries.dto.js';
import { ListFixedAssetsQueryDto } from './dto/list-fixed-assets.dto.js';
import { RunDepreciationDto } from './dto/run-depreciation.dto.js';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto.js';

@Controller('fixed-assets')
@UseGuards(PermissionGuard)
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Post('categories')
  @RequirePermission('fixed-asset.manage')
  async createCategory(@Body() dto: CreateFixedAssetCategoryDto) {
    return this.fixedAssetsService.createCategory(dto);
  }

  @Get('categories')
  @RequirePermission('fixed-asset.read')
  async listCategories() {
    return this.fixedAssetsService.listCategories();
  }

  @Patch('categories/:id/deactivate')
  @RequirePermission('fixed-asset.manage')
  async deactivateCategory(@Param('id') id: string) {
    return this.fixedAssetsService.deactivateCategory(id);
  }

  @Patch('categories/:id/reactivate')
  @RequirePermission('fixed-asset.manage')
  async reactivateCategory(@Param('id') id: string) {
    return this.fixedAssetsService.reactivateCategory(id);
  }

  @Post()
  @RequirePermission('fixed-asset.manage')
  async createAsset(@Body() dto: CreateFixedAssetDto) {
    return this.fixedAssetsService.createAsset(dto);
  }

  @Get()
  @RequirePermission('fixed-asset.read')
  async listAssets(
    @Query() query: ListFixedAssetsQueryDto,
  ) {
    return this.fixedAssetsService.listAssets(query);
  }

  @Post('depreciation/run')
  @RequirePermission('fixed-asset.manage')
  async runDepreciation(@Body() dto: RunDepreciationDto) {
    return this.fixedAssetsService.runDepreciationAccrual(dto.month, dto.year);
  }

  @Get('depreciation')
  @RequirePermission('fixed-asset.read')
  async listDepreciationEntries(@Query() query: ListDepreciationEntriesQueryDto) {
    return this.fixedAssetsService.listDepreciationEntries(query);
  }

  @Get(':id')
  @RequirePermission('fixed-asset.read')
  async getAsset(@Param('id') id: string) {
    return this.fixedAssetsService.getAsset(id);
  }

  @Get(':id/valuation')
  @RequirePermission('fixed-asset.read')
  async getValuation(@Param('id') id: string) {
    return this.fixedAssetsService.getAssetValuation(id);
  }

  @Patch(':id')
  @RequirePermission('fixed-asset.manage')
  async updateAsset(@Param('id') id: string, @Body() dto: UpdateFixedAssetDto) {
    return this.fixedAssetsService.updateAsset(id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermission('fixed-asset.manage')
  async deactivateAsset(@Param('id') id: string) {
    return this.fixedAssetsService.deactivateAsset(id);
  }

  @Patch(':id/reactivate')
  @RequirePermission('fixed-asset.manage')
  async reactivateAsset(@Param('id') id: string) {
    return this.fixedAssetsService.reactivateAsset(id);
  }
}
