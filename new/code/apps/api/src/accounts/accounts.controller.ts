import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { Account } from './entities/account.entity.js';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AssignRoleDto } from './dto/assign-role.dto.js';

const REQUIRED_PERMISSION = 'identity.accounts.manage';

function toAccountResponse(account: Account): Omit<Account, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = account;
  return rest;
}

@Controller('accounts')
@UseGuards(PermissionGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateAccountDto) {
    const account = await this.accountsService.createStaffAccount({
      ...body,
      needsPasswordUpdate: true,
    });
    return toAccountResponse(account);
  }

  @Get('roles')
  @RequirePermission(REQUIRED_PERMISSION)
  async listRoles() {
    const roles = await this.accountsService.listRoles();
    return roles.map(r => ({ name: r.name, description: r.description }));
  }

  @Get()
  @RequirePermission(REQUIRED_PERMISSION)
  async list(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const result = await this.accountsService.listAccounts({ page: pageNum, limit: limitNum });
    return { ...result, data: result.data.map(toAccountResponse) };
  }

  @Get(':id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getOne(@Param('id') id: string) {
    const found = await this.accountsService.getAccountWithRoles(id);
    if (!found) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return { account: toAccountResponse(found.account), roleNames: found.roleNames };
  }

  @Patch(':id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivate(@Param('id') id: string) {
    const account = await this.accountsService.deactivateAccount(id);
    return toAccountResponse(account);
  }

  @Patch(':id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivate(@Param('id') id: string) {
    const account = await this.accountsService.reactivateAccount(id);
    return toAccountResponse(account);
  }

  @Patch(':id/unlock')
  @RequirePermission(REQUIRED_PERMISSION)
  async unlock(@Param('id') id: string) {
    const account = await this.accountsService.adminUnlockAccount(id);
    return toAccountResponse(account);
  }

  @Post(':id/roles')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async assignRole(@Param('id') id: string, @Body() body: AssignRoleDto) {
    return this.accountsService.assignRole(
      id,
      body.roleName,
      body.startDate ? new Date(body.startDate) : undefined,
      body.endDate ? new Date(body.endDate) : undefined,
    );
  }

  @Delete(':id/roles/:accountRoleId')
  @RequirePermission(REQUIRED_PERMISSION)
  async revokeRole(@Param('id') id: string, @Param('accountRoleId') accountRoleId: string) {
    await this.accountsService.revokeRoleAssignment(id, accountRoleId);
    return { revoked: true };
  }
}
