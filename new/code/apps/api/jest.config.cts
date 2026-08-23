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
  // schemas/roles, and seed the RBAC catalog in beforeAll — multi-tenant provisioning (55 migrations
  // per schema) on a dev machine under parallel load comfortably completes within 120s.
  testTimeout: 120000,
  // The suite keeps growing (78 suites, each provisioning tenant schemas against one shared
  // Postgres); Jest's default worker count parallelizes that provisioning faster than the DB (and
  // this dev machine) can serve it, pushing beforeAll past the timeout. Cap workers to 2 so the DB
  // connection pool and DDL migrations do not suffer from lock contention / starvation.
  maxWorkers: 2,
  coverageDirectory: 'test-output/jest/coverage',
};
