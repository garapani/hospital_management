import { Module } from '@nestjs/common';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabCatalogController } from './lab-catalog.controller.js';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabWorkflowController } from './lab-workflow.controller.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { LabOrderCancellationSubscriber } from './lab-order-cancellation.subscriber.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PdfModule } from '@hospital/pdf';
import { ObjectStorageModule } from '@hospital/object-storage';

@Module({
  imports: [OrdersModule, PdfModule, ObjectStorageModule],
  controllers: [LabCatalogController, LabWorkflowController],
  providers: [
    LabCatalogService,
    LabWorkflowService,
    LabRequisitionNumberGeneratorService,
    LabOrderCancellationSubscriber,
  ],
  exports: [LabCatalogService, LabWorkflowService],
})
export class LabModule {}
