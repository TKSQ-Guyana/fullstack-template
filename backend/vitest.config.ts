import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Tests must be runnable with no database and no Keycloak: everything that
    // needs the outside world points at unroutable defaults set here.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // 127.0.0.1:9 (discard) refuses instantly, so healthcheck() answers
      // false fast instead of waiting out the connection timeout.
      DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:9/app_test',
      AUTH_MODE: 'enforce',
      REDIS_ENABLED: 'false',
      MAIL_ENABLED: 'false',
      DMS_ENABLED: 'false',
    },
  },
})
