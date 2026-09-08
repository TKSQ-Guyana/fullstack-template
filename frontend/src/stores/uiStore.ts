// Transient chrome state: toasts (and room for drawers/modals as the app
// grows). One plain create() — no persist middleware: chrome state dying with
// the tab is correct.
//
// A TOAST ACTION IS A PATH, NOT A CALLBACK: the toast outlives the screen
// that raised it, and the Toaster (guaranteed still mounted) owns the
// navigate.
import { create } from 'zustand'

export type ToastTone = 'info' | 'ok' | 'danger'

export interface Toast {
  id: number
  message: string
  tone: ToastTone
  action?: { label: string; to: string }
}

interface UiState {
  toasts: Toast[]
  toast: (message: string, tone?: ToastTone, action?: Toast['action']) => void
  dismissToast: (id: number) => void
}

let nextId = 1

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  toast: (message, tone = 'info', action) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextId++, message, tone, action }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const selectToasts = (s: UiState) => s.toasts
