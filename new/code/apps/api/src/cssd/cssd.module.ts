import { Module } from '@nestjs/common';
import { CssdService } from './cssd.service.js';
import { CssdController } from './cssd.controller.js';

@Module({
  controllers: [CssdController],
  providers: [CssdService],
  exports: [CssdService],
})
export class CssdModule {}
