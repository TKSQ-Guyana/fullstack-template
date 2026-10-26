// ESLint flat config — TypeScript strict, Prettier-compatible.
// Mirrors the frontend's posture (eslint 9 flat config + prettier last).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import boundaries from 'eslint-plugin-boundaries'

// The MVC layering (docs/ARCHITECTURE.md §3.2), made a lint error rather than
// a convention: `domain` imports nothing but itself; `repositories` know the
// database and the domain; `services` orchestrate domain + repositories +
// integrations and call the presenters, so a use-case answers with the
// contract JSON; `presenters` shape the repositories' rows and the
// integrations' records (type-only imports); `controllers` reach services and
// presenters plus the domain, HTTP helpers, middleware, auth, db,
// integrations and mfa. `middleware` reaches the domain for its errors: the
// error handler turns a DomainError into the response. SHARED (config,
// logger, utils, redis) is reachable from every layer except `domain`.
const LAYERS = [
  { type: 'domain', pattern: 'src/domain/**' },
  { type: 'repositories', pattern: 'src/repositories/**' },
  { type: 'services', pattern: 'src/services/**' },
  { type: 'integrations', pattern: 'src/integrations/**' },
  { type: 'presenters', pattern: 'src/presenters/**' },
  { type: 'controllers', pattern: 'src/controllers/**' },
  { type: 'jobs', pattern: 'src/jobs/**' },
  { type: 'db', pattern: 'src/db/**' },
  { type: 'http', pattern: 'src/http/**' },
  { type: 'middleware', pattern: 'src/middleware/**' },
  { type: 'auth', pattern: 'src/auth/**' },
  { type: 'mfa', pattern: 'src/mfa/**' },
  { type: 'shared', pattern: ['src/config/**', 'src/utils/**', 'src/redis/**'] },
  // A single file is an element only in `file` mode; a folder pattern never
  // matches it, and an import of an unmatched file goes unchecked.
  { type: 'shared', mode: 'file', pattern: 'src/logger.ts' },
  { type: 'app', mode: 'file', pattern: ['src/app.ts', 'src/index.ts'] },
]
const SHARED = ['shared']

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'src/db/schema.generated.ts'] },
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
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      // The source's NodeNext specifiers name the emitted '.js'; the TypeScript
      // resolver maps each to its '.ts' file, so the rule below sees the layer
      // an import reaches. The default Node resolver finds no file behind such
      // a specifier, and the rule lets an import it cannot resolve pass.
      'import/resolver': {
        typescript: { project: `${import.meta.dirname}/tsconfig.json` },
      },
      'boundaries/elements': LAYERS,
      'boundaries/ignore': ['**/*.test.ts'],
    },
    rules: {
      // An import the rule cannot place in a layer is an error, not a pass —
      // so a resolver or pattern that stops matching fails the lint loudly.
      'boundaries/no-unknown': 'error',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Pure: entities, value objects, rules, DomainError.
            { from: 'domain', allow: ['domain'] },
            { from: 'repositories', allow: ['repositories', 'domain', 'db', ...SHARED] },
            {
              from: 'services',
              allow: [
                'services',
                'domain',
                'repositories',
                'integrations',
                'presenters',
                'db',
                'http',
                'auth',
                ...SHARED,
              ],
            },
            {
              from: 'integrations',
              allow: ['integrations', 'domain', 'db', 'http', 'auth', ...SHARED],
            },
            // Presenters take the repositories' ROW TYPES and the integrations'
            // record types (type-only imports).
            {
              from: 'presenters',
              allow: ['presenters', 'domain', 'repositories', 'integrations', ...SHARED],
            },
            {
              from: 'controllers',
              allow: [
                'controllers',
                'services',
                'presenters',
                'domain',
                'http',
                'middleware',
                'auth',
                'db',
                'integrations',
                'mfa',
                ...SHARED,
              ],
            },
            // Sweeps and timers: call services, own no rules.
            {
              from: 'jobs',
              allow: [
                'jobs',
                'services',
                'repositories',
                'domain',
                'db',
                'auth',
                'integrations',
                ...SHARED,
              ],
            },
            { from: 'db', allow: ['db', 'auth', ...SHARED] },
            { from: 'http', allow: ['http', ...SHARED] },
            {
              from: 'middleware',
              allow: ['middleware', 'http', 'domain', 'auth', 'db', 'integrations', ...SHARED],
            },
            { from: 'auth', allow: ['auth', 'http', 'db', 'integrations', ...SHARED] },
            { from: 'mfa', allow: ['mfa', 'http', 'db', 'integrations', ...SHARED] },
            { from: 'shared', allow: ['shared', 'auth'] },
            { from: 'app', allow: ['*'] },
          ],
        },
      ],
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
