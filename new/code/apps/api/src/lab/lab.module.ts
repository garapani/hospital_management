import { Module } from '@nestjs/common';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabCatalogController } from './lab-catalog.controller.js';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabWorkflowController } from './lab-workflow.controller.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [OrdersModule],
  controllers: [LabCatalogController, LabWorkflowController],
  providers: [LabCatalogService, LabWorkflowService, LabRequisitionNumberGeneratorService],
  exports: [LabCatalogService, LabWorkflowService],
})
export class LabModule {}
