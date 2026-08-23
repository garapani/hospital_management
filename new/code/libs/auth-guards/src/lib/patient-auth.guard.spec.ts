import { ForbiddenException } from '@nestjs/common';
import { PatientAuthGuard } from './patient-auth.guard.js';

describe('PatientAuthGuard', () => {
  function buildContext(authContext: { accountType?: 'staff' | 'patient' } | undefined) {
    const guard = new PatientAuthGuard();
    const request = { authContext };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    return { guard, context };
  }

  it('allows a patient-portal account', () => {
    const { guard, context } = buildContext({ accountType: 'patient' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a staff account', () => {
    const { guard, context } = buildContext({ accountType: 'staff' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects when authContext is absent entirely', () => {
    const { guard, context } = buildContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
