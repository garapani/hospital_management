import { RequestContextFactory } from './request-context.js';

describe('RequestContextFactory', () => {
  it('builds a request context from forwarded headers', () => {
    const factory = new RequestContextFactory();
    const headers: Record<string, string | undefined> = {
      'x-account-id': 'acc-1',
      'x-tenant-id': 'h1',
      'x-roles': 'Doctor, Nurse',
      'x-permissions': 'clinical.notes.write',
    };
    const req = { header: (name: string) => headers[name] } as any;

    expect(factory.fromRequest(req)).toEqual({
      accountId: 'acc-1',
      hospitalId: 'h1',
      roles: ['Doctor', 'Nurse'],
      permissions: ['clinical.notes.write'],
      patientId: undefined,
    });
  });

  it('defaults to empty arrays and undefined fields when no headers are present', () => {
    const factory = new RequestContextFactory();
    const req = { header: () => undefined } as any;

    expect(factory.fromRequest(req)).toEqual({
      accountId: undefined,
      hospitalId: undefined,
      roles: [],
      permissions: [],
      patientId: undefined,
    });
  });
});
