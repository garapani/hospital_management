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
      'boundaries/include': ['apps/api/src/**/*.ts'],
      'boundaries/elements': [
        { type: 'scope:platform', pattern: 'apps/api/src/(app|database|rbac|audit|auth|testing)/**' },
        { type: 'domain:accounts', pattern: 'apps/api/src/accounts/**' },
        { type: 'domain:admissions', pattern: 'apps/api/src/admissions/**' },
        { type: 'domain:appointments', pattern: 'apps/api/src/appointments/**' },
        { type: 'domain:billing', pattern: 'apps/api/src/billing/**' },
        { type: 'domain:clinical-vitals', pattern: 'apps/api/src/clinical/vitals/**' },
        { type: 'domain:clinical-encounters', pattern: 'apps/api/src/clinical/encounters/**' },
        { type: 'domain:clinical-triage', pattern: 'apps/api/src/clinical/triage/**' },
        { type: 'domain:master-data', pattern: 'apps/api/src/master-data/**' },
        { type: 'domain:orders', pattern: 'apps/api/src/orders/**' },
        { type: 'domain:patients', pattern: 'apps/api/src/patients/**' },
        { type: 'domain:tenants', pattern: 'apps/api/src/tenants/**' },
        { type: 'scope:reporting', pattern: 'apps/api/src/reporting/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: ['scope:platform'],
              allow: ['scope:platform', 'domain:accounts'],
            },
            {
              from: [
                'domain:accounts', 'domain:admissions', 'domain:appointments', 'domain:billing',
                'domain:clinical-vitals', 'domain:clinical-encounters', 'domain:clinical-triage',
                'domain:master-data', 'domain:orders', 'domain:patients', 'domain:tenants',
              ],
              allow: ['scope:platform'],
            },
            { from: ['domain:admissions'], allow: ['domain:appointments', 'domain:clinical-triage', 'domain:master-data', 'domain:patients'] },
            { from: ['domain:billing'], allow: ['domain:patients'] },
            { from: ['domain:orders'], allow: ['domain:patients'] },
            { from: ['scope:reporting'], allow: ['scope:platform', 'domain:accounts', 'domain:admissions', 'domain:appointments', 'domain:billing', 'domain:clinical-vitals', 'domain:clinical-encounters', 'domain:clinical-triage', 'domain:master-data', 'domain:orders', 'domain:patients', 'domain:tenants'] },
          ],
        },
      ],
    },
  },
];
