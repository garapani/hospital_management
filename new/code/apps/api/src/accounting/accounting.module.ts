import { Module } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';
import { AccountingController } from './accounting.controller.js';
import { JournalNumberGeneratorService } from './journal-number-generator.service.js';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, JournalNumberGeneratorService],
  exports: [AccountingService],
})
export class AccountingModule {}
