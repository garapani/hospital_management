const DEV_ONLY_DEFAULT_SECRET = 'dev-only-insecure-secret-change-in-production';

export function resolveJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (secret) {
    return secret;
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return DEV_ONLY_DEFAULT_SECRET;
}
