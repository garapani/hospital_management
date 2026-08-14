import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { SequenceNumberGeneratorService } from '../database/sequence-number-generator.service.js';

@Injectable()
export class LabRequisitionNumberGeneratorService {
  private readonly sequenceGenerator: SequenceNumberGeneratorService;

  constructor(tenantConnection: TenantConnectionService) {
    this.sequenceGenerator = new SequenceNumberGeneratorService(tenantConnection);
  }

  generateNextRequisitionNumber(prefix = 'LAB'): Promise<string> {
    return this.sequenceGenerator.generateNext('lab_requisition_sequences', prefix);
  }
}
