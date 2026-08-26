import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';

describe('PermissionGuard', () => {
  function buildContext(
    permissions: string[] | undefined,
    requiredPermission: string | undefined,
  ) {
    // Mirrors Reflector.getAllAndOverride: handler metadata wins, class metadata is the
    // fallback. `get` is not used by the guard anymore (it reads handler + class) — the mock
    // provides both shapes so a regression in either direction fails loudly.
    const reflector = {
      get: () => requiredPermission,
      getAllAndOverride: (key: string, targets: unknown[]) =>
        targets[0] ?? targets[1],
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const request = {
      authContext: permissions === undefined ? undefined : { permissions },
    };
    const context = {
      getHandler: () => (requiredPermission === undefined ? undefined : requiredPermission),
      getClass: () => undefined,
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

  it('honors a class-level required permission when the handler has none', () => {
    // Regression for the rbac P2: the guard used to read handler metadata only, so a
    // class-level @RequirePermission was silently ignored. getAllAndOverride falls back to the
    // class when the handler carries nothing.
    const reflector = {
      getAllAndOverride: () => 'class-level.perm',
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const request = { authContext: { permissions: ['class-level.perm'] } };
    const context = {
      getHandler: () => undefined,
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('lets a handler-level permission override a class-level one', () => {
    const reflector = {
      getAllAndOverride: (key: string, targets: unknown[]) =>
        targets[0] ?? targets[1],
    } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const request = { authContext: { permissions: ['handler.perm'] } };
    const context = {
      getHandler: () => 'handler.perm',
      getClass: () => 'class.perm',
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    expect(guard.canActivate(context)).toBe(true);
  });
});
