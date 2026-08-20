import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { LabCatalogService } from './lab-catalog.service.js';
import { CreateLabTestCategoryDto } from './dto/create-lab-test-category.dto.js';
import { CreateLabTestDto } from './dto/create-lab-test.dto.js';
import { CreateLabTestComponentDto } from './dto/create-lab-test-component.dto.js';
import { UpdatePriceDto } from './dto/update-price.dto.js';

@Controller('lab')
@UseGuards(PermissionGuard)
export class LabCatalogController {
  constructor(private readonly labCatalogService: LabCatalogService) {}

  @Post('categories')
  @RequirePermission('lab.catalog.manage')
  async createCategory(@Body() dto: CreateLabTestCategoryDto) {
    return this.labCatalogService.createCategory(dto);
  }

  @Get('categories')
  @RequirePermission('lab.read')
  async listCategories() {
    return this.labCatalogService.listCategories();
  }

  @Post('tests')
  @RequirePermission('lab.catalog.manage')
  async createTest(@Body() dto: CreateLabTestDto) {
    return this.labCatalogService.createTest(dto);
  }

  @Get('categories/:categoryId/tests')
  @RequirePermission('lab.read')
  async listTestsByCategory(@Param('categoryId') categoryId: string) {
    return this.labCatalogService.listTestsByCategory(categoryId);
  }

  @Get('tests/:id')
  @RequirePermission('lab.read')
  async getTest(@Param('id') id: string) {
    return this.labCatalogService.getTest(id);
  }

  @Patch('tests/:id/price')
  @RequirePermission('lab.catalog.manage')
  async updateTestPrice(@Param('id') id: string, @Body() dto: UpdatePriceDto) {
    return this.labCatalogService.updateTestPrice(id, dto.price);
  }

  @Post('tests/:testId/components')
  @RequirePermission('lab.catalog.manage')
  async createComponent(@Param('testId') testId: string, @Body() dto: CreateLabTestComponentDto) {
    return this.labCatalogService.createComponent(testId, dto);
  }

  @Get('tests/:testId/components')
  @RequirePermission('lab.read')
  async listComponentsByTest(@Param('testId') testId: string) {
    return this.labCatalogService.listComponentsByTest(testId);
  }
}
