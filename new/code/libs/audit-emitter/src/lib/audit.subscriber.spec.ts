import 'reflect-metadata';
import { InsertEvent, RemoveEvent, UpdateEvent } from 'typeorm';
import { AuditExclude } from './audit-exclude.decorator.js';
import { AuditEventPublisher } from './audit-event-publisher.interface.js';
import { AuditSubscriber } from './audit.subscriber.js';
import { TenantContextService } from '@hospital/tenant-context';

class Account {
  id!: string;
  username!: string;
  @AuditExclude()
  passwordHash!: string;
}

describe('AuditSubscriber', () => {
  function buildSubscriber() {
    const published: unknown[] = [];
    const publisher: AuditEventPublisher = {
      publish: async (event: unknown) => {
        published.push(event);
      },
    };
    const tenantContext = new TenantContextService();
    const subscriber = new AuditSubscriber(publisher, tenantContext);
    return { subscriber, tenantContext, published };
  }

  it('publishes a create event with the correct diff on afterInsert', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const entity = Object.assign(new Account(), { id: '1', username: 'alice', passwordHash: 'h' });
    const event = { metadata: { tableName: 'account' }, entity } as unknown as InsertEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', accountId: 'admin-1', correlationId: 'corr-1' }, () =>
      subscriber.afterInsert(event),
    );

    expect(published).toEqual([
      {
        tableName: 'account',
        recordId: '1',
        action: 'create',
        hospitalId: 'h1',
        changedByAccountId: 'admin-1',
        correlationId: 'corr-1',
        diff: [{ field: 'username', before: null, after: 'alice' }],
        occurredAt: expect.any(String),
      },
    ]);
  });

  it('publishes an update event containing only changed, non-excluded fields', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const databaseEntity = Object.assign(new Account(), {
      id: '1',
      username: 'alice',
      passwordHash: 'old',
    });
    const entity = Object.assign(new Account(), { id: '1', username: 'alice2', passwordHash: 'new' });
    const event = {
      metadata: { tableName: 'account' },
      entity,
      databaseEntity,
    } as unknown as UpdateEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', correlationId: 'corr-2' }, () =>
      subscriber.afterUpdate(event),
    );

    expect(published).toEqual([
      expect.objectContaining({
        action: 'update',
        diff: [{ field: 'username', before: 'alice', after: 'alice2' }],
      }),
    ]);
  });

  it('does not publish when the only changed fields are audit-excluded', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const databaseEntity = Object.assign(new Account(), {
      id: '1',
      username: 'alice',
      passwordHash: 'old',
    });
    const entity = Object.assign(new Account(), { id: '1', username: 'alice', passwordHash: 'new' });
    const event = {
      metadata: { tableName: 'account' },
      entity,
      databaseEntity,
    } as unknown as UpdateEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', correlationId: 'corr-3' }, () =>
      subscriber.afterUpdate(event),
    );

    expect(published).toEqual([]);
  });

  it('publishes a delete event on afterRemove', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const databaseEntity = Object.assign(new Account(), {
      id: '1',
      username: 'alice',
      passwordHash: 'h',
    });
    const event = {
      metadata: { tableName: 'account' },
      databaseEntity,
    } as unknown as RemoveEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', correlationId: 'corr-4' }, () =>
      subscriber.afterRemove(event),
    );

    expect(published).toEqual([
      expect.objectContaining({
        action: 'delete',
        diff: [{ field: 'username', before: 'alice', after: null }],
      }),
    ]);
  });
});
