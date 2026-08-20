import { Module } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service.js';
import { HelpdeskController } from './helpdesk.controller.js';
import { HelpdeskTicketNumberGeneratorService } from './helpdesk-ticket-number-generator.service.js';

@Module({
  controllers: [HelpdeskController],
  providers: [HelpdeskService, HelpdeskTicketNumberGeneratorService],
  exports: [HelpdeskService],
})
export class HelpdeskModule {}
