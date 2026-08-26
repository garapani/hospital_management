/**
 * Cross-package smoke check for @hospital/tenant-context, run directly with
 * `tsx` (not Jest) so the import actually goes through Node's real module
 * resolution instead of @swc/jest's transform.
 *
 *   pnpm exec tsx apps/api/src/verify-esm-interop.ts
 *
 * VERIFIED LIMITATION - read before relying on this for ERR_REQUIRE_ESM:
 * this script does NOT prove that apps/api/package.json's
 * "type": "module" field prevents ERR_REQUIRE_ESM. Both were checked
 * empirically:
 *   1. `tsx` ships its own CJS<->ESM interop bridge that transparently
 *      loads ESM-only packages even when the importing file is treated as
 *      CommonJS - this script keeps passing even with "type": "module"
 *      removed from apps/api/package.json, and still passes
 *      even under `NODE_OPTIONS=--no-experimental-require-module` (which
 *      rules out Node's own require(esm) feature as the explanation).
 *   2. Separately, on this workspace's Node version (v23.10.0),
 *      `require()` of a synchronous ESM graph succeeds by default
 *      (`--experimental-require-module` defaults to true), so even a
 *      plain CommonJS `require()` of @hospital/tenant-context would not
 *      throw ERR_REQUIRE_ESM here unless that flag is explicitly disabled.
 *
 * So this file is a genuine regression check for "does the exported API
 * still resolve and behave correctly" (wrong export names, wrong return
 * values, etc.), but it is NOT a substitute for a real build+run
 * (`nx build` -> `node dist/main.js`) once production code actually
 * imports @hospital/tenant-context - that is the only way to observe the
 * real compiled require()/import() shape webpack produces for this
 * package. Do not treat a green run of this script as proof that
 * "type": "module" is still doing anything.
 *
 * THE AUTHORITATIVE REGRESSION GUARD IS ELSEWHERE: see
 * apps/api/src/esm-package-type.spec.ts. It doesn't try to
 * exercise Node's real module boundary at all (that boundary turned out to
 * be sandbox/tool-dependent, as documented above) - instead it just asserts
 * apps/api/package.json still declares "type": "module", which
 * is the actual config invariant that ERR_REQUIRE_ESM depends on. That
 * assertion can't be fooled by any transform, sandbox Node version, or
 * tool-specific interop bridge, because it never crosses a module-loading
 * boundary in the first place - it just reads JSON. Treat this tsx script
 * as illustrative only; treat esm-package-type.spec.ts as the real gate.
 */
import { TenantContextService } from '@hospital/tenant-context';

const service = new TenantContextService();
const result = service.run({ tenantId: 'verify-123', correlationId: 'verify' }, () =>
  service.getTenantId(),
);

if (result !== 'verify-123') {
  console.error('ESM interop check FAILED: unexpected result', result);
  process.exit(1);
}

console.log('ESM interop check passed: @hospital/tenant-context resolved and executed correctly.');
