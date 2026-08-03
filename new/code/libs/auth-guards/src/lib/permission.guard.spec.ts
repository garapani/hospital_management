import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';

describe('PermissionGuard', () => {
  function buildContext(
    permissions: string[] | undefined,
    requiredPermission: string | undefined,
  ) {
    const reflector = { get: () => requiredPermission } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const request = {
      authContext: permissions === undefined ? undefined : { permissions },
    };
    const context = {
      getHandler: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    return { guard, context };
  }

  it('allows the request when no permission is required', () => {
    const { guard, context } = buildContext(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request when the required permission is present', () => {
    const { guard, context } = buildContext(
      ['billing.invoice.create', 'billing.invoice.read'],
      'billing.invoice.create',
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the required permission is missing', () => {
    const { guard, context } = buildContext(
      ['billing.invoice.read'],
      'billing.invoice.create',
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when req.authContext is absent entirely', () => {
    const { guard, context } = buildContext(
      undefined,
      'billing.invoice.create',
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
