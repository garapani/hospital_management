import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  tenantId?: string;
  accountId?: string;
  correlationId: string;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  getTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  getAccountId(): string | undefined {
    return this.storage.getStore()?.accountId;
  }

  getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  getSchemaName(): string | undefined {
    const tenantId = this.getTenantId();
    return tenantId ? `tenant_${tenantId}` : undefined;
  }
}
