// A confirmation asked OVER whatever is open — z-70 on the ladder (Modal.tsx).
import { createPortal } from 'react-dom'
import { Button } from './Button'

export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel = 'Confirm',
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  detail?: string
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center bg-ink-900/40 p-6">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-pop"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {detail && <p className="mt-2 text-sm text-ink-500">{detail}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
