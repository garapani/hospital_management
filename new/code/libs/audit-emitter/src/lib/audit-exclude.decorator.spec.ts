import 'reflect-metadata';
import { AuditExclude, getAuditExcludedFields } from './audit-exclude.decorator.js';

describe('AuditExclude', () => {
  it('records decorated property names on the class', () => {
    class Account {
      username!: string;
      @AuditExclude()
      passwordHash!: string;
      @AuditExclude()
      otpCode!: string;
    }

    expect(getAuditExcludedFields(Account)).toEqual(['passwordHash', 'otpCode']);
  });

  it('returns an empty array for a class with no excluded fields', () => {
    class PlainEntity {
      name!: string;
    }

    expect(getAuditExcludedFields(PlainEntity)).toEqual([]);
  });
});
