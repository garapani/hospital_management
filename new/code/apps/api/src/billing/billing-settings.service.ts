import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { BillingSettings } from './entities/billing-settings.entity.js';

const SETTINGS_ID = 'default';

export interface UpdateBillingSettingsInput {
  gstin: string;
  stateCode: string;
  hospitalLegalName: string;
}

@Injectable()
export class BillingSettingsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async get(): Promise<BillingSettings | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(BillingSettings).findOne({ where: { id: SETTINGS_ID } }),
    );
  }

  async update(input: UpdateBillingSettingsInput): Promise<BillingSettings> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(BillingSettings);
      return repository.save(
        repository.create({
          id: SETTINGS_ID,
          gstin: input.gstin,
          stateCode: input.stateCode,
          hospitalLegalName: input.hospitalLegalName,
        }),
      );
    });
  }
}
