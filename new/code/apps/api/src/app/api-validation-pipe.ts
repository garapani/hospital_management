import { ValidationPipe } from '@nestjs/common';

// Shared by main.ts (production bootstrap) and any integration spec that boots the real AppModule
// via Test.createTestingModule — those specs bypass main.ts entirely, so the pipe has to be
// registered explicitly there too for a test to prove it's actually wired. See
// new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md for why whitelist/
// forbidNonWhitelisted stay off: only 9 of 104 DTOs carry any class-validator decorator, and
// whitelist strips any field with zero decorators — turning it on now would silently empty the
// other 95 DTOs' request bodies.
export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    whitelist: false,
    forbidNonWhitelisted: false,
  });
}
