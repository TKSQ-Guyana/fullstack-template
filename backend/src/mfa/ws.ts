// The desktop's live "approved" signal — a WebSocket per pending login token,
// pinged the moment the phone's assertion verifies.
//
//   * PATH: the socket answers at `<base>/mfa/ws` for EVERY configured base
//     path (noServer + manual upgrade routing — ws's `path` option takes
//     exactly one path). Upgrades bypass Express, so this attaches to the
//     HTTP server itself in ../index.ts.
//
//   * CROSS-INSTANCE FAN-OUT: with the store in Postgres, the phone's
//     verification can land on a DIFFERENT backend replica than the one
//     holding the desktop's socket. The verdict therefore also rides
//     pg_notify on `app_mfa_events`, and every instance pushes to its own
//     local sockets on receipt. The verifying instance pushes directly AND
//     hears its own notify; a doubled "verified" message is harmless (the
//     client resolves once), where a dedup scheme would be one more thing to
//     break. If the LISTEN connection is down, the polling fallback still
//     delivers the verdict — slower, never lost.
import type { Server } from 'node:http'
import pg from 'pg'
import { WebSocketServer, type WebSocket } from 'ws'
import { env } from '../config/env.js'
import { logger } from '../logger.js'
import { pool } from '../db/pool.js'
import { getLoginToken } from './store.js'

const CHANNEL = 'app_mfa_events'

const clientsByToken = new Map<string, Set<WebSocket>>()
let listenClient: pg.Client | null = null
let stopped = false

function pushLocal(token: string): void {
  const sockets = clientsByToken.get(token)
  if (!sockets) return
  const payload = JSON.stringify({ event: 'verified' })
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

async function connectListener(): Promise<void> {
  listenClient = new pg.Client({ connectionString: env.DATABASE_URL })
  listenClient.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return
    try {
      const { token } = JSON.parse(msg.payload) as { token?: string }
      if (token) pushLocal(token)
    } catch {
      logger.warn({ payload: msg.payload }, 'unparseable app_mfa_events payload')
    }
  })
  listenClient.on('error', (err) => {
    logger.warn({ err: err.message }, 'mfa listen connection lost')
    if (!stopped) setTimeout(() => void connectListener().catch(() => undefined), 5000).unref()
  })
  await listenClient.connect()
  await listenClient.query(`LISTEN ${CHANNEL}`)
}

export function attachWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })
  const paths = new Set(env.basePaths.map((b) => `${b}/mfa/ws`))

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '', 'http://localhost').pathname
    if (!paths.has(pathname)) {
      // Not ours, and nothing else on this server speaks WebSocket.
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost')
    const token = url.searchParams.get('token')
    if (!token) {
      ws.close(4000, 'Invalid or expired login token')
      return
    }
    // Register FIRST, synchronously — the token check is a DB round-trip, and
    // a verdict arriving inside that window must still find this socket.
    // Validation then closes the invalid ones after the fact (the close
    // handler below cleans the registration up).
    if (!clientsByToken.has(token)) clientsByToken.set(token, new Set())
    clientsByToken.get(token)?.add(ws)
    ws.on('close', () => {
      clientsByToken.get(token)?.delete(ws)
      if (clientsByToken.get(token)?.size === 0) clientsByToken.delete(token)
    })
    getLoginToken(token).then(
      (entry) => {
        if (!entry) ws.close(4000, 'Invalid or expired login token')
      },
      () => ws.close(1011, 'store unavailable'),
    )
  })

  connectListener().catch((err: Error) =>
    // Degraded, not broken: the polling fallback carries the verdict.
    logger.warn({ err: err.message }, 'could not start mfa listen connection'),
  )

  return wss
}

export async function stopMfaListener(): Promise<void> {
  stopped = true
  await listenClient?.end().catch(() => undefined)
}

export async function notifyLoginVerified(token: string): Promise<void> {
  pushLocal(token)
  await pool
    .query(`SELECT pg_notify('${CHANNEL}', $1)`, [JSON.stringify({ token })])
    .catch(() => undefined) // local push already happened; polling covers the rest
}
