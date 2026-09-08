// The toast rail — a portal to document.body, bottom-centre.
//
// Auto-dismiss: 3600ms, or 8000ms when the toast carries an action (right for
// reading a sentence; wrong for reading it AND deciding to click). The
// container is pointer-events-none and only an actioned toast is
// pointer-events-auto, so plain toasts never swallow page clicks. THE TOASTER
// OWNS THE NAVIGATE — it is the one component guaranteed still mounted when
// the toast is clicked, which is why an action is {label, to} and never a
// callback.
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useUiStore, selectToasts, type Toast } from '@/stores/uiStore'
import { cn } from '@/utils/cn'

const TONE: Record<Toast['tone'], string> = {
  info: 'bg-ink-900 text-white',
  ok: 'bg-ok text-white',
  danger: 'bg-danger text-white',
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((s) => s.dismissToast)
  const navigate = useNavigate()

  useEffect(() => {
    const ttl = toast.action ? 8000 : 3600
    const timer = setTimeout(() => dismiss(toast.id), ttl)
    return () => clearTimeout(timer)
  }, [toast, dismiss])

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-pop',
        toast.action && 'pointer-events-auto',
        TONE[toast.tone],
      )}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="font-semibold underline underline-offset-2"
          onClick={() => {
            dismiss(toast.id)
            navigate(toast.action!.to)
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

export function Toaster() {
  const toasts = useUiStore(selectToasts)
  if (toasts.length === 0) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}
