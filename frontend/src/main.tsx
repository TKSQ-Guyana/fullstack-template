import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers'
import { AppRoutes } from '@/routes/AppRoutes'
import '@/index.css'

if (import.meta.env.DEV) {
  // Dev-only manifest audit — dynamically imported so none of it ships.
  void import('@/routes/integrity').then((m) => m.reportManifestIntegrity())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  </StrictMode>,
)
