import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipeBuilder,
  Put,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { MAX_LOGO_BYTES, PlatformBrandingService } from './platform-branding.service.js';
import { UpsertBrandingDto } from './dto/upsert-branding.dto.js';

// Platform-only: Super Admin configures a hospital's white-label look. Same permission as tenant
// management — this is a tenant-registry-adjacent setting, not a hospital-editable preference.
const REQUIRED_PERMISSION = 'system-admin.tenants.manage';

// Local shape instead of the ambient `Express.Multer.File` global: this app's tsconfig restricts
// `types` to `["node"]` (a protected file — see new/code/CLAUDE.md), so `@types/multer`'s global
// augmentation never gets included regardless of whether the package is installed. Only the
// fields this controller actually reads.
interface UploadedFileLike {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('platform/tenants/:hospitalId/branding')
@UseGuards(PermissionGuard)
export class PlatformBrandingController {
  constructor(private readonly brandingService: PlatformBrandingService) {}

  @Get()
  @RequirePermission(REQUIRED_PERMISSION)
  async get(@Param('hospitalId') hospitalId: string) {
    return this.brandingService.getBrandingForAdmin(hospitalId);
  }

  @Put()
  @RequirePermission(REQUIRED_PERMISSION)
  async upsert(@Param('hospitalId') hospitalId: string, @Body() dto: UpsertBrandingDto) {
    return this.brandingService.upsertBranding(hospitalId, dto);
  }

  @Post('logo')
  @RequirePermission(REQUIRED_PERMISSION)
  // Bounds memory: without `limits.fileSize`, multer's default in-memory storage buffers the
  // entire upload before the service layer's own MAX_LOGO_BYTES check ever runs — a large enough
  // upload is a memory-pressure vector regardless of the documented 2MB limit. Same cap as the
  // service's own check, exported from there so the two can't drift apart.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }))
  async uploadLogo(
    @Param('hospitalId') hospitalId: string,
    @UploadedFile(
      new ParseFilePipeBuilder().build({ fileIsRequired: true, errorHttpStatusCode: 400 }),
    )
    file: UploadedFileLike,
  ) {
    return this.brandingService.uploadLogo(hospitalId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Delete('logo')
  @RequirePermission(REQUIRED_PERMISSION)
  async removeLogo(@Param('hospitalId') hospitalId: string) {
    return this.brandingService.removeLogo(hospitalId);
  }
}
