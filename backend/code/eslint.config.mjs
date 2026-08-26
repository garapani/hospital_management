import nx from '@nx/eslint-plugin';
import boundaries from 'eslint-plugin-boundaries';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            // Every project depends on this root config file; without this the rule
            // would flag every project's own reference to it as a boundary violation.
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
          ],
          depConstraints: [
            {
              sourceTag: 'type:platform-lib',
              onlyDependOnLibsWithTags: ['type:platform-lib'],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:platform-lib', 'type:app'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {},
  },
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // Nx invokes eslint for the `api` project with cwd set to apps/api itself, so element
      // patterns below (unlike the `files` glob above, which resolves relative to this config
      // file's own location) must be written relative to apps/api, not the workspace root.
      'import/resolver': {
        typescript: true,
      },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        // app.module.ts (wires every domain module together), database/* (DB connection +
        // DataSource configs that register every domain's entities), rbac/audit/auth/testing
        // (shared infra and test scaffolding) are all composition-adjacent in this codebase —
        // restricting what THEY may read isn't this guardrail's goal. Only domain-to-domain
        // leakage is restricted (see the policies below).
        { type: 'scope:platform', pattern: 'src/(app|database|rbac|audit|auth|testing)/**' },
        { type: 'domain:accounts', pattern: 'src/accounts/**' },
        { type: 'domain:admissions', pattern: 'src/admissions/**' },
        { type: 'domain:appointments', pattern: 'src/appointments/**' },
        { type: 'domain:billing', pattern: 'src/billing/**' },
        { type: 'domain:clinical-vitals', pattern: 'src/clinical/vitals/**' },
        { type: 'domain:clinical-encounters', pattern: 'src/clinical/encounters/**' },
        { type: 'domain:clinical-triage', pattern: 'src/clinical/triage/**' },
        { type: 'domain:master-data', pattern: 'src/master-data/**' },
        { type: 'domain:orders', pattern: 'src/orders/**' },
        { type: 'domain:patients', pattern: 'src/patients/**' },
        { type: 'domain:tenants', pattern: 'src/tenants/**' },
        { type: 'scope:reporting', pattern: 'src/reporting/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'scope:platform' } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'scope:platform', 'domain:accounts', 'domain:admissions', 'domain:appointments',
                        'domain:billing', 'domain:clinical-vitals', 'domain:clinical-encounters',
                        'domain:clinical-triage', 'domain:master-data', 'domain:orders', 'domain:patients',
                        'domain:tenants', 'scope:reporting',
                      ],
                    },
                  },
                },
              },
            },
            {
              from: {
                element: {
                  types: {
                    anyOf: [
                      'domain:accounts', 'domain:admissions', 'domain:appointments', 'domain:billing',
                      'domain:clinical-vitals', 'domain:clinical-encounters', 'domain:clinical-triage',
                      'domain:master-data', 'domain:orders', 'domain:patients', 'domain:tenants',
                    ],
                  },
                },
              },
              allow: { to: { element: { type: 'scope:platform' } } },
            },
            {
              from: { element: { type: 'domain:admissions' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['domain:appointments', 'domain:clinical-triage', 'domain:master-data', 'domain:patients'] },
                  },
                },
              },
            },
            {
              from: { element: { type: 'domain:billing' } },
              allow: { to: { element: { type: 'domain:patients' } } },
            },
            {
              // Tenant provisioning seeds a new tenant's initial departments from the global
              // department catalog (master-data's DepartmentCatalog/Department entities).
              from: { element: { type: 'domain:tenants' } },
              allow: { to: { element: { type: 'domain:master-data' } } },
            },
            {
              from: { element: { type: 'domain:orders' } },
              allow: { to: { element: { type: 'domain:patients' } } },
            },
            {
              // Test-fixture-only edges: triage/vitals integration specs seed patient fixtures.
              from: { element: { type: 'domain:clinical-triage' } },
              allow: { to: { element: { type: 'domain:patients' } } },
            },
            {
              from: { element: { type: 'domain:clinical-vitals' } },
              allow: { to: { element: { type: 'domain:patients' } } },
            },
            {
              from: { element: { type: 'scope:reporting' } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        'scope:platform', 'domain:accounts', 'domain:admissions', 'domain:appointments',
                        'domain:billing', 'domain:clinical-vitals', 'domain:clinical-encounters',
                        'domain:clinical-triage', 'domain:master-data', 'domain:orders', 'domain:patients',
                        'domain:tenants',
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    },
  },
];
