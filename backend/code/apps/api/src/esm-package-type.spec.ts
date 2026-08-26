import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// NOTE: this file relies on the ambient `__dirname` (from @types/node), not
// `import.meta.url`. Jest/@swc/jest always runs spec files through a
// CommonJS module wrapper regardless of this app's "type": "module" (it
// injects its own `__dirname`/`__filename`/`require` bindings), so
// re-deriving __dirname from import.meta.url collides with that injected
// binding ("Identifier '__dirname' has already been declared"). This is
// fine here because spec files are Jest-only and never part of the
// production ESM build.
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8'),
) as { type?: string };

// Authoritative regression guard (see also verify-esm-interop.ts, which is
// illustrative only): the @hospital/tenant-context, @hospital/auth-guards,
// and @hospital/audit-emitter libraries are all "type": "module" with no
// "require" export condition. Under this workspace's tsconfig.base.json
// ("module"/"moduleResolution": "nodenext"), if this app's own package.json
// ever loses "type": "module", TypeScript compiles its imports of those
// libraries to CommonJS require() calls, which fail at real Node <22.12
// runtime (our target is Node 20 LTS) with ERR_REQUIRE_ESM - even though
// this does not reproduce on a newer local/sandbox Node that has
// require(esm) enabled by default (Node >=22.12).
//
// Verified directly on this sandbox (Node v23.10.0):
//   NODE_OPTIONS=--no-experimental-require-module node -e \
//     "require('<repo>/libs/tenant-context/src/index.ts')"
// reproduces ERR_REQUIRE_ESM exactly when that flag simulates pre-22.12
// (Node 20-equivalent) behavior. This test can't reach across that runtime
// boundary from inside Jest (its transform doesn't enforce Node's runtime
// module resolution rules), so instead it pins the config invariant that
// causes the failure: this app's package.json must declare
// "type": "module". A plain file read can't be fooled by any transform,
// sandbox Node version, or tool-specific interop bridge.
describe('apps/api package.json module type', () => {
  it('declares "type": "module" so it can import the pure-ESM @hospital/* shared libraries', () => {
    expect(packageJson.type).toBe('module');
  });
});
