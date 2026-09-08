// THE OVERLAY LADDER, stated once so no component picks a z-index by hand:
//
//   z-20      sidebar
//   z-50/51   drawers, popovers (scrim / panel)
//   z-60/61   Modal — always above whatever opened it
//   z-70      ConfirmDialog — asked *over* a modal
//   z-80      toasts — must stay readable above everything
//
// Panel is always ONE ABOVE its scrim, never equal: a tie is settled by DOM
// order, which no component should have to reason about.
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-ink-900/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'absolute top-1/2 left-1/2 z-[61] w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-pop',
          wide ? 'max-w-2xl' : 'max-w-md',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="-m-1 rounded-md p-1 text-ink-400 hover:text-ink-900"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
