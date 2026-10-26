// Tests live BESIDE the code they test (src/**/*.test.ts): the domain's pure
// rules, the presenters, the HTTP surface through buildApp(). Repository
// tests that need Postgres are src/**/*.db.test.ts and run only in db mode,
// against DATABASE_URL (the dev stack on 5433):
//   npm test            unit + HTTP tests — no database, no Keycloak
//   npm run test:db     repository tests against DATABASE_URL (vitest --mode db)
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const withDb = mode === 'db'
  return {
    test: {
      environment: 'node',
      include: withDb ? ['src/**/*.db.test.ts'] : ['src/**/*.test.ts'],
      exclude: withDb
        ? ['node_modules/**', 'dist/**']
        : ['src/**/*.db.test.ts', 'node_modules/**', 'dist/**'],
      // Unit runs must need no database and no Keycloak: everything that needs
      // the outside world points at unroutable defaults set here. db mode
      // keeps the caller's DATABASE_URL.
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        // 127.0.0.1:9 (discard) refuses instantly, so healthcheck() answers
        // false fast instead of waiting out the connection timeout.
        DATABASE_URL: withDb
          ? (process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/app_db')
          : 'postgres://postgres:postgres@127.0.0.1:9/app_test',
        AUTH_MODE: 'enforce',
        REDIS_ENABLED: 'false',
        MAIL_ENABLED: 'false',
        DMS_ENABLED: 'false',
      },
    },
  }
})
