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
import { CreateAccountDto, ChangeOwnPasswordDto, ResetPasswordDto } from './dto/create-account.dto.js';
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
    // needsPasswordUpdate is decided by the service (true when the initial password was
    // generated, false when the admin supplied one). A generated password is returned once.
    // allowPlatformRole is an internal seed-only escape hatch — force it off here so a forged
    // request body can never create a Super Admin account.
    const account = await this.accountsService.createStaffAccount({
      ...body,
      allowPlatformRole: false,
    });
    const { initialPassword, ...rest } = account;
    return { ...toAccountResponse(rest as Account), initialPassword };
  }

  /** Self-service password change — auth-only (no permission), for the must-change flow. */
  @Post('me/password')
  @HttpCode(HttpStatus.OK)
  async changeOwnPassword(@Body() body: ChangeOwnPasswordDto) {
    await this.accountsService.changeOwnPassword(body.currentPassword, body.newPassword);
    return { success: true };
  }

  @Get('roles')
  @RequirePermission(REQUIRED_PERMISSION)
  async listRoles() {
    const roles = await this.accountsService.listRoles();
    return roles.map(r => ({ name: r.name, description: r.description }));
  }

  @Get()
  @RequirePermission(REQUIRED_PERMISSION)
  async list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const accounts = await this.accountsService.listAccounts(
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
    return accounts.map(toAccountResponse);
  }

  @Get(':id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getOne(@Param('id') id: string) {
    const found = await this.accountsService.getAccountWithRoles(id);
    if (!found) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return {
      account: toAccountResponse(found.account),
      roleIds: found.roleIds,
      roleNames: found.roleNames,
      assignments: found.assignments,
    };
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

  /** Admin-initiated password reset (forgotten-password recovery). Generates a one-time
   *  initial password when none is supplied; the account must change it on next login. */
  @Post(':id/reset-password')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Param('id') id: string, @Body() body: ResetPasswordDto = {}) {
    const { initialPassword } = await this.accountsService.resetPassword(id, body.password);
    return initialPassword ? { success: true, initialPassword } : { success: true };
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
