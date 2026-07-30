import { Reflector } from '@nestjs/core';
import {
  REQUIRED_PERMISSION_KEY,
  RequirePermission,
} from './require-permission.decorator.js';

describe('RequirePermission', () => {
  it('sets the required-permission metadata on the handler', () => {
    class TestController {
      @RequirePermission('billing.invoice.create')
      handler() {
        return undefined;
      }
    }

    const reflector = new Reflector();
    const value = reflector.get(
      REQUIRED_PERMISSION_KEY,
      TestController.prototype.handler,
    );
    expect(value).toBe('billing.invoice.create');
  });
});
