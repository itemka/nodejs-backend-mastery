import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import pluginN from 'eslint-plugin-n';
import pluginPromise from 'eslint-plugin-promise';
import unicorn from 'eslint-plugin-unicorn';
import perfectionist from 'eslint-plugin-perfectionist';

export default [
  // Global ignores - must be first
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },

  // Base JS recommendations with proper parser settings
  {
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
  },

  pluginN.configs['flat/recommended'],
  pluginPromise.configs['flat/recommended'],
  unicorn.configs.recommended,

  // Override parser for .mjs and .js files (when package.json has "type": "module")
  {
    files: ['**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2020 },
    },
    rules: {
      'n/no-unpublished-import': 'off', // Allow devDependencies in build scripts
    },
  },

  // TypeScript with typed rules (only for TS files)
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx,cts,mts}'],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx,cts,mts}'],
  })),

  // Project-tuned settings & rules
  {
    name: 'project:setup',
    files: ['**/*.{ts,tsx,cts,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: true, // auto-picks nearest tsconfig.json
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2020,
      },
    },
    plugins: {
      perfectionist,
    },
    rules: {
      // TS hygiene
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Imports/Node rules tuned for monorepo/TS resolution
      'n/no-missing-import': 'off',
      'n/no-unpublished-import': 'off',

      // Useful unicorn tweaks (keep the rest from preset)
      'unicorn/prevent-abbreviations': 'off', // too noisy in real codebases
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/filename-case': [
        'error',
        {
          // Allow multiple conventions across the monorepo.
          cases: {
            kebabCase: true,
            camelCase: true,
            pascalCase: true,
          },
        },
      ],

      // Nice, autofixable order for imports/keys/etc.
      'perfectionist/sort-imports': [
        'warn',
        {
          type: 'natural',
          order: 'asc',
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
          newlinesBetween: 'always',
        },
      ],
      'perfectionist/sort-objects': [
        'warn',
        {
          type: 'natural',
          order: 'asc',
        },
      ],

      // Nice, autofixable order for statements
      'padding-line-between-statements': [
        'warn',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
      ],
    },
  },

  // Tests: relax a few aggressive typed rules when convenient
  {
    name: 'project:tests',
    files: ['**/*.{test,spec}.{ts,tsx,js}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'unicorn/no-null': 'off',
    },
  },
];
