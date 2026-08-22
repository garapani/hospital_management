import { ValidationPipe } from '@nestjs/common';

// Shared by main.ts (production bootstrap) and any integration spec that boots the real AppModule
// via Test.createTestingModule — those specs bypass main.ts entirely, so the pipe has to be
// registered explicitly there too for a test to prove it's actually wired.
//
// Phase B (2.14 Phase B / claude-code-tasks.md 2.18): all 104 DTOs under apps/api/src now carry at
// least one class-validator decorator per field (see
// new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md for the Phase A/B split),
// so `whitelist: true` is safe — every field, on every DTO, has a decorator for it to key off of.
// `forbidNonWhitelisted` stays off: an unexpected extra field is silently stripped rather than
// rejected with 400, which is the more conservative rollout choice for a change touching every
// controller in the app. Revisit once whitelist has run in production for a while with no
// surprises.
export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    whitelist: true,
    forbidNonWhitelisted: false,
  });
}
