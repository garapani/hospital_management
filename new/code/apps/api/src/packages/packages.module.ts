import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PackagesService } from './packages.service.js';
import { PackagesController } from './packages.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
