import { resolveJwtSecret } from './jwt-secret.js';

describe('resolveJwtSecret', () => {
  const originalSecret = process.env['JWT_SECRET'];
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env['JWT_SECRET'];
    } else {
      process.env['JWT_SECRET'] = originalSecret;
    }
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('returns JWT_SECRET when set', () => {
    process.env['JWT_SECRET'] = 'a-real-secret';
    expect(resolveJwtSecret()).toBe('a-real-secret');
  });

  it('falls back to the dev-only default when unset and not in production', () => {
    delete process.env['JWT_SECRET'];
    process.env['NODE_ENV'] = 'test';
    expect(resolveJwtSecret()).toBe('dev-only-insecure-secret-change-in-production');
  });

  it('throws when unset and NODE_ENV is production', () => {
    delete process.env['JWT_SECRET'];
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveJwtSecret()).toThrow('JWT_SECRET must be set in production');
  });
});
