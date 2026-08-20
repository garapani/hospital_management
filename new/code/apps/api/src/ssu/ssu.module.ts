import { Module } from '@nestjs/common';
import { SsuService } from './ssu.service.js';
import { SsuController } from './ssu.controller.js';
import { SsuCaseNumberGeneratorService } from './ssu-case-number-generator.service.js';

@Module({
  controllers: [SsuController],
  providers: [SsuService, SsuCaseNumberGeneratorService],
  exports: [SsuService],
})
export class SsuModule {}
