import { JwtService } from '@nestjs/jwt';
import { signTestToken } from './test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('signTestToken', () => {
  it('signs a token verifiable with the same secret the app uses, defaulting roles/permissions to empty arrays', async () => {
    const token = await signTestToken({ sub: 'acc-1', hospitalId: 'h1' });
    const verifier = new JwtService({ secret: resolveJwtSecret() });

    const payload = await verifier.verifyAsync(token);
    expect(payload).toMatchObject({
      sub: 'acc-1',
      hospitalId: 'h1',
      roles: [],
      permissions: [],
      type: 'access',
    });
  });

  it('signs a token carrying the provided roles and permissions', async () => {
    const token = await signTestToken({
      sub: 'acc-2',
      hospitalId: 'h2',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
    });
    const verifier = new JwtService({ secret: resolveJwtSecret() });

    const payload = await verifier.verifyAsync(token);
    expect(payload).toMatchObject({
      sub: 'acc-2',
      hospitalId: 'h2',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
      type: 'access',
    });
  });
});
