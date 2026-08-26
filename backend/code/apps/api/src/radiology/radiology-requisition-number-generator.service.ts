import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { SequenceNumberGeneratorService } from '../database/sequence-number-generator.service.js';

@Injectable()
export class RadiologyRequisitionNumberGeneratorService {
  private readonly sequenceGenerator: SequenceNumberGeneratorService;

  constructor(tenantConnection: TenantConnectionService) {
    this.sequenceGenerator = new SequenceNumberGeneratorService(tenantConnection);
  }

  generateNextRequisitionNumber(prefix = 'RAD'): Promise<string> {
    return this.sequenceGenerator.generateNext('radiology_requisition_sequences', prefix);
  }
}
