import { Module } from '@nestjs/common';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { RadiologyCatalogController } from './radiology-catalog.controller.js';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { RadiologyWorkflowController } from './radiology-workflow.controller.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PdfModule } from '@hospital/pdf';
import { ObjectStorageModule } from '@hospital/object-storage';

@Module({
  imports: [OrdersModule, PdfModule, ObjectStorageModule],
  controllers: [RadiologyCatalogController, RadiologyWorkflowController],
  providers: [RadiologyCatalogService, RadiologyWorkflowService, RadiologyRequisitionNumberGeneratorService],
  exports: [RadiologyCatalogService, RadiologyWorkflowService],
})
export class RadiologyModule {}
