import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard } from '@hospital/auth-guards';
import { DirectoryService, DirectoryResolveResult } from './directory.service.js';
import { ResolveDirectoryDto } from './dto/resolve-directory.dto.js';

@Controller('directory')
@UseGuards(PermissionGuard)
export class DirectoryController {
  constructor(private readonly directoryService: DirectoryService) {}

  // No @RequirePermission — see DirectoryService.resolve's doc comment. Any authenticated tenant
  // request may resolve names for ids it already holds.
  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Body() body: ResolveDirectoryDto): Promise<DirectoryResolveResult> {
    return this.directoryService.resolve(body);
  }
}
