import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { RoleManagementController } from './role-management.controller.js';
import { RoleManagementService } from './role-management.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [RoleManagementController],
  providers: [RoleManagementService],
})
export class RbacModule {}
