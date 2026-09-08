// HTTP-level tests against buildApp() — the same construction path the server
// uses (src/app.ts exports the app without listening for exactly this).
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { buildApp } from '../src/app.js'
import { pool } from '../src/db/pool.js'

const app = buildApp()

afterAll(async () => {
  await pool.end().catch(() => undefined)
})

describe('GET /health', () => {
  it('answers with the readiness shape (degraded here: no database in tests)', async () => {
    const res = await request(app).get('/health')
    const body = res.body as Record<string, unknown>
    expect(res.status).toBe(503)
    expect(body).toMatchObject({ status: 'degraded', db: false, redis: 'disabled' })
    expect(typeof body.uptimeSeconds).toBe('number')
  })
})

describe('unknown endpoints', () => {
  it('outside the API answer RFC-7807 problem+json 404', async () => {
    const res = await request(app).get('/nowhere')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toContain('application/problem+json')
    expect(res.body).toMatchObject({ title: 'Not Found', status: 404 })
  })

  it('inside the API meet authenticate first: 401 problem+json without a session', async () => {
    const res = await request(app).get('/app/v1/nowhere')
    expect(res.status).toBe(401)
    expect(res.headers['content-type']).toContain('application/problem+json')
  })
})

describe('GET /me', () => {
  it('requires a session in enforce mode', async () => {
    const res = await request(app).get('/api/v1/me')
    expect(res.status).toBe(401)
  })
})
