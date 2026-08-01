import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

const explicitAnyExceptions = [
  'packages/core/src/__tests__/**/*.ts',
  'packages/core/src/tools/build-executor.ts',
  'packages/core/src/tools/tool-catalog.ts',
  'packages/core/src/tools/studio-client.ts',
  'packages/core/src/tools/index.ts',
  'packages/core/src/tools/mutation-tools.ts',
  'packages/core/src/tools/script-tools.ts',
  'packages/core/src/opencloud-client.ts',
  'packages/core/src/roblox-cookie-client.ts',
  'packages/core/src/marketplace-client.ts',
  'packages/core/src/image-client.ts',
  'packages/core/src/tools/asset-tools.ts',
  'packages/core/src/tools/runtime-tools.ts',
  'packages/core/src/tools/setup-registry.ts',
];

export default [
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      'studio-plugin/out/**',
    ],
  },
  js.configs.recommended,
  {
    // Test fixtures under packages/*/src are Node scripts too. Without them here
    // the fixtures are outside every config block, so `process` and the timer
    // globals read as undefined and the files can only be linted by hand.
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'packages/*/src/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      sourceType: 'module',
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'evals/**/*.ts', 'studio-plugin/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parser: tsParser,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-undef': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: explicitAnyExceptions,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
