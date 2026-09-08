import { useUiStore } from '@/stores/uiStore'

/** The one way screens raise a toast. */
export const useToast = () => useUiStore((s) => s.toast)
