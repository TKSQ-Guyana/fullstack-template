// Copy the non-TS build inputs into dist: the email templates and the
// OpenAPI spec.
//
// tsc emits .ts and nothing else, so a build without this step produces a
// dist/ whose emailTemplates.js reads a directory that is not there — and the
// failure surfaces at the first send, in production, as "no runtime email
// template". The same applies to routes/docs.js and dist/docs/openapi.yaml,
// except that one fails loud at boot (and only when API_DOCS_ENABLED). Part
// of `npm run build` rather than a Dockerfile line so that EVERY build
// produces a complete dist: the image, the pre-push check, and anybody
// running `node dist/index.js` locally.
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const from = path.join(here, '..', 'src', 'templates')
const to = path.join(here, '..', 'dist', 'templates')

await mkdir(path.dirname(to), { recursive: true })
await cp(from, to, { recursive: true })
console.log(`templates -> ${path.relative(path.join(here, '..'), to)}`)

const docsFrom = path.join(here, '..', 'src', 'docs')
const docsTo = path.join(here, '..', 'dist', 'docs')
await cp(docsFrom, docsTo, { recursive: true })
console.log(`docs -> ${path.relative(path.join(here, '..'), docsTo)}`)
