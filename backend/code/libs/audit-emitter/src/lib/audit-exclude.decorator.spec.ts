import 'reflect-metadata';
import {
  AuditExclude,
  AuditExcludeEntity,
  getAuditExcludedFields,
  isAuditExcludedEntity,
} from './audit-exclude.decorator.js';

describe('AuditExclude', () => {
  it('records decorated property names on the class', () => {
    class Account {
      username!: string;
      @AuditExclude()
      passwordHash!: string;
      @AuditExclude()
      otpCode!: string;
    }

    expect(getAuditExcludedFields(Account)).toEqual([
      'passwordHash',
      'otpCode',
    ]);
  });

  it('returns an empty array for a class with no excluded fields', () => {
    class PlainEntity {
      name!: string;
    }

    expect(getAuditExcludedFields(PlainEntity)).toEqual([]);
  });
});

describe('AuditExcludeEntity', () => {
  it('marks a class as excluded from auditing entirely', () => {
    @AuditExcludeEntity()
    class SelfReferentialLog {
      id!: string;
    }

    expect(isAuditExcludedEntity(SelfReferentialLog)).toBe(true);
  });

  it('returns false for a class with no entity-level exclusion', () => {
    class PlainEntity {
      name!: string;
    }

    expect(isAuditExcludedEntity(PlainEntity)).toBe(false);
  });
});
