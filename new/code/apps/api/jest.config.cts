/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: [
    '**/?(*.)+(spec|test).[jt]s?(x)',
    '**/?(*.)+(integration-spec).[jt]s?(x)',
  ],
  // Full-AppModule integration suites compile the whole Nest DI graph, provision tenant
  // schemas/roles, and seed the RBAC catalog in beforeAll — comfortably more than Jest's
  // default 5000ms once multiple suites run in parallel workers (or a shared dev machine is
  // otherwise under load). 60s is a ceiling, not a target: individual tests that genuinely
  // hang (e.g. the historical ThrottlerGuard/Redis port hang) still time out, and the heaviest
  // test in the repo — the tenant-test-context "self-heals" test, which provisions a tenant
  // schema twice (two full migration runs) — stays comfortably inside it even under full-suite
  // parallel load.
  testTimeout: 60000,
  // The suite keeps growing (78 suites, each provisioning tenant schemas against one shared
  // Postgres); Jest's default worker count parallelizes that provisioning faster than the DB (and
  // this dev machine) can serve it, pushing beforeAll past the timeout. Cap workers so the DB is
  // the bottleneck, not the timeouts.
  maxWorkers: 4,
  coverageDirectory: 'test-output/jest/coverage',
};
