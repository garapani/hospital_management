import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { MaternityService } from './maternity.service.js';
import { CreateMaternityRecordDto } from './dto/create-maternity-record.dto.js';
import { ListMaternityRecordsQueryDto } from './dto/list-maternity-records.dto.js';
import { RecordDeliveryDto } from './dto/record-delivery.dto.js';
import { UpdateMaternityRecordDto } from './dto/update-maternity-record.dto.js';

@Controller('maternity')
@UseGuards(PermissionGuard)
export class MaternityController {
  constructor(private readonly maternityService: MaternityService) {}

  @Post('records')
  @RequirePermission('maternity.manage')
  async createRecord(@Body() dto: CreateMaternityRecordDto) {
    return this.maternityService.createRecord(dto);
  }

  @Get('records')
  @RequirePermission('maternity.read')
  async listRecords(@Query() query: ListMaternityRecordsQueryDto) {
    return this.maternityService.listRecords(query);
  }

  @Get('records/:id')
  @RequirePermission('maternity.read')
  async getRecord(@Param('id') id: string) {
    return this.maternityService.getRecord(id);
  }

  @Post('records/:id/delivery')
  @RequirePermission('maternity.manage')
  async recordDelivery(@Param('id') id: string, @Body() dto: RecordDeliveryDto) {
    return this.maternityService.recordDelivery(id, dto);
  }

  @Patch('records/:id')
  @RequirePermission('maternity.manage')
  async updateRecord(@Param('id') id: string, @Body() dto: UpdateMaternityRecordDto) {
    return this.maternityService.updateRecord(id, dto);
  }
}
