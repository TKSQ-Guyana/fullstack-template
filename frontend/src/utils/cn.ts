import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Class names: clsx for conditionals, twMerge so a caller's override wins. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
