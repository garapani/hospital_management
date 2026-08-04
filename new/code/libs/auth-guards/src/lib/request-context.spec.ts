import { UnauthorizedException } from '@nestjs/common';
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

  it('throws UnauthorizedException when authContext is absent, without trusting any headers', () => {
    const factory = new RequestContextFactory();
    const req = {
      header: () => {
        throw new Error('should not read headers when authContext is absent');
      },
    } as any;

    expect(() => factory.fromRequest(req)).toThrow(UnauthorizedException);
  });
});
