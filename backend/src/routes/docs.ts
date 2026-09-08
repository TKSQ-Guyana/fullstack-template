// Swagger UI + the OpenAPI spec, mounted only when API_DOCS_ENABLED (dev
// stacks; the deployed default is off, so a production instance never serves
// its own map).
//
// Self-hosted swagger-ui-dist rather than the swagger-ui-express middleware:
// helmet's default CSP (script-src 'self', script-src-attr 'none') rules out
// any CDN and any inline bootstrap script, and the dist's stock index.html
// happens to satisfy it exactly — every script it loads is a same-origin
// relative file. The one file that must differ is swagger-initializer.js
// (the dist's points at the petstore), so a route registered BEFORE the
// static handler shadows it with ours.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Router } from 'express'
import swaggerUiDist from 'swagger-ui-dist'
import { parse } from 'yaml'

const here = path.dirname(fileURLToPath(import.meta.url))
// src/routes -> src/docs when tsx runs the sources; dist/routes -> dist/docs
// in a build (copy-templates.mjs lifts src/docs there) — the same relative
// resolution the email templates rely on.
const specPath = path.join(here, '..', 'docs', 'openapi.yaml')

export function buildDocsRouter(): Router {
  const docs = express.Router()

  // Read once at startup, fail loud: a stack that asked for docs and cannot
  // serve them should say so at boot, not 500 at the first visit. A stack
  // with the flag off never constructs this router and never touches the file.
  const specYaml = fs.readFileSync(specPath, 'utf8')
  const specJson = JSON.stringify(parse(specYaml))

  docs.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').send(specYaml)
  })
  docs.get('/openapi.json', (_req, res) => {
    res.type('application/json').send(specJson)
  })

  // The relative url is what lets one page work under BOTH base paths
  // (/app/v1/docs/ through nginx at :3000, /api/v1/docs/ direct at :8081) —
  // express.static's directory redirect guarantees the document URL ends in
  // /docs/, so ./openapi.json resolves beside it either way.
  docs.get('/swagger-initializer.js', (_req, res) => {
    res.type('application/javascript').send(
      `window.onload = () => {
  window.ui = SwaggerUIBundle({
    url: './openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
  })
}
`,
    )
  })

  docs.use(express.static(swaggerUiDist.getAbsoluteFSPath()))
  return docs
}
