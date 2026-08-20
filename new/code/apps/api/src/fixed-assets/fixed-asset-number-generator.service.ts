import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { SequenceNumberGeneratorService } from '../database/sequence-number-generator.service.js';

@Injectable()
export class FixedAssetNumberGeneratorService {
  private readonly sequenceGenerator: SequenceNumberGeneratorService;

  constructor(tenantConnection: TenantConnectionService) {
    this.sequenceGenerator = new SequenceNumberGeneratorService(tenantConnection);
  }

  generateNextAssetCode(): Promise<string> {
    return this.sequenceGenerator.generateNext('fixed_asset_sequences', 'AST');
  }
}
