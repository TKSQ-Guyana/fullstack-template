// The phone-facing MFA pages, built to be SERVED BY THE BACKEND at
// <base>/mfa/enroll and <base>/mfa/verify (src/mfa/index.ts).
//
//   base       every asset URL is prefixed with the primary API base path +
//              /mfa, so the pages work behind the same edge door as the API —
//              no nginx rewrite, no extra WAF rule.
//   assetsDir  'mfa-assets' so the backend's express.static can serve the
//              hashed build output without colliding with API routes.
//
// The backend Dockerfile builds this workspace via a named build context and
// copies dist/ to ./mfa-ui inside the image (MFA_UI_DIR).
import { defineConfig } from 'vite'

const base = process.env.MFA_BASE_PATH || '/app/v1/mfa/'

export default defineConfig({
  base,
  build: {
    assetsDir: 'mfa-assets',
  },
  server: {
    port: 5273,
  },
})
