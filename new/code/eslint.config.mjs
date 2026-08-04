import nx from '@nx/eslint-plugin';

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
];
