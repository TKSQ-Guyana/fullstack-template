// ESLint flat config — TypeScript strict, Prettier-compatible.
// Mirrors the frontend's posture (eslint 9 flat config + prettier last).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Plain-JS tooling scripts are linted without type information.
          allowDefaultProject: ['*.js', '*.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Express handlers are habitually async; misuse is caught by the wrapper types.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', 'scripts/**'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // MERGED, not replaced: disableTypeChecked carries the parserOptions
      // that turn the project service OFF for these files. A bare
      // `languageOptions` here would override that spread, so every script
      // would still be parsed type-aware and count against
      // allowDefaultProject's hard cap of 8.
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        TextEncoder: 'readonly',
        Buffer: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
  },
  prettier,
)
