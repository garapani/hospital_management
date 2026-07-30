import 'reflect-metadata';
import { AuditExclude } from './audit-exclude.decorator.js';
import { buildAuditDiff } from './build-audit-diff.js';

class Account {
  username!: string;
  @AuditExclude()
  passwordHash!: string;
}

describe('buildAuditDiff', () => {
  it('includes only fields that changed', () => {
    const diff = buildAuditDiff(
      Account,
      { username: 'alice', passwordHash: 'old-hash' },
      { username: 'alice2', passwordHash: 'old-hash' },
    );

    expect(diff).toEqual([
      { field: 'username', before: 'alice', after: 'alice2' },
    ]);
  });

  it('never includes a field marked with @AuditExclude, even when it changed', () => {
    const diff = buildAuditDiff(
      Account,
      { username: 'alice', passwordHash: 'old-hash' },
      { username: 'alice', passwordHash: 'new-hash' },
    );

    expect(diff).toEqual([]);
  });

  it('treats a null before as a create, diffing every non-excluded field', () => {
    const diff = buildAuditDiff(Account, null, {
      username: 'alice',
      passwordHash: 'hash',
    });
    expect(diff).toEqual([{ field: 'username', before: null, after: 'alice' }]);
  });

  it('treats a null after as a delete, diffing every non-excluded field', () => {
    const diff = buildAuditDiff(
      Account,
      { username: 'alice', passwordHash: 'hash' },
      null,
    );
    expect(diff).toEqual([{ field: 'username', before: 'alice', after: null }]);
  });
});
