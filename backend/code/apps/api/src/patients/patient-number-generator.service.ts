import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { SequenceNumberGeneratorService } from '../database/sequence-number-generator.service.js';

@Injectable()
export class PatientNumberGeneratorService {
  private readonly sequenceGenerator: SequenceNumberGeneratorService;

  constructor(tenantConnection: TenantConnectionService) {
    this.sequenceGenerator = new SequenceNumberGeneratorService(tenantConnection);
  }

  generateNextPatientNumber(prefix = 'PAT'): Promise<string> {
    return this.sequenceGenerator.generateNext('patient_sequences', prefix);
  }
}
