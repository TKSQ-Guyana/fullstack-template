// The sign-in shell: one centred card on the canvas.
import type { ReactNode } from 'react'
import { RUNTIME_CONFIG } from '@/config/runtime'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-[408px]">
        <div className="mb-6 text-center">
          <div className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
            {RUNTIME_CONFIG.appName}
          </div>
        </div>
        <div className="rounded-2xl border border-rule bg-surface p-7 shadow-card">{children}</div>
      </div>
    </div>
  )
}
