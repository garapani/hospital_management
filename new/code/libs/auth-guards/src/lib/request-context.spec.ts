import { RequestContextFactory } from './request-context.js';

describe('RequestContextFactory', () => {
  it('returns req.authContext directly when present, ignoring headers', () => {
    const factory = new RequestContextFactory();
    const req = {
      header: () => {
        throw new Error('should not read headers when authContext is present');
      },
      authContext: {
        accountId: 'acc-1',
        hospitalId: 'h1',
        roles: ['Doctor'],
        permissions: ['clinical.notes.write'],
        patientId: undefined,
      },
    } as any;

    expect(factory.fromRequest(req)).toEqual({
      accountId: 'acc-1',
      hospitalId: 'h1',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
      patientId: undefined,
    });
  });

  it('falls back to forwarded headers when authContext is absent (login/refresh routes)', () => {
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

  it('defaults to empty arrays and undefined fields when authContext is absent and no headers are present', () => {
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
