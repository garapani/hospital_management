import { Module } from '@nestjs/common';
import { PdfModule } from '@hospital/pdf';
import { ExcelModule } from '@hospital/excel';
import { AccountingService } from './accounting.service.js';
import { AccountingExportService } from './accounting-export.service.js';
import { AccountingController } from './accounting.controller.js';
import { JournalNumberGeneratorService } from './journal-number-generator.service.js';

@Module({
  imports: [PdfModule, ExcelModule],
  controllers: [AccountingController],
  providers: [AccountingService, AccountingExportService, JournalNumberGeneratorService],
  exports: [AccountingService],
})
export class AccountingModule {}
