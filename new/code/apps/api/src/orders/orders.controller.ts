import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { OrdersService } from './orders.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { CompleteOrderItemDto } from './dto/complete-order-item.dto.js';
import { CancelOrderItemDto } from './dto/cancel-order-item.dto.js';
import { SearchOrdersDto } from './dto/search-orders.dto.js';

@Controller('orders')
@UseGuards(PermissionGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @RequirePermission('order.manage')
  async create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Get()
  @RequirePermission('order.read')
  async list(@Query() query: SearchOrdersDto) {
    return this.ordersService.list(query);
  }

  @Get(':id')
  @RequirePermission('order.read')
  async findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id/items/:itemId/complete')
  @RequirePermission('order.manage')
  async completeItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: CompleteOrderItemDto) {
    return this.ordersService.completeItem(id, itemId, dto);
  }

  @Patch(':id/items/:itemId/cancel')
  @RequirePermission('order.manage')
  async cancelItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: CancelOrderItemDto) {
    return this.ordersService.cancelItem(id, itemId, dto);
  }
}
