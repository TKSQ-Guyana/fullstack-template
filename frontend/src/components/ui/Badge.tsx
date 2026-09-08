import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info'

const TONE: Record<Tone, string> = {
  neutral: 'bg-canvas text-ink-700',
  ok: 'bg-ok-wash text-ok',
  warn: 'bg-warn-wash text-warn',
  danger: 'bg-danger-wash text-danger',
  info: 'bg-info-wash text-info',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TONE[tone],
      )}
    >
      {children}
    </span>
  )
}
