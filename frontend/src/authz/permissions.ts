// The permission CATALOGUE — every capability the UI can ask about, as a
// typed union so a typo in a <Can> or a manifest entry is a compile error,
// not a silently-hidden button.
//
// ═══ REPLACE WITH YOUR PERMISSIONS ═══ alongside policy.ts and the backend's
// auth/permissions.ts (the operation matrix) — the two sides must agree, and
// GET /me's permissions map is the runtime cross-check.

export const PERMISSIONS = [
  'notes:read',
  'notes:write',
  'reference:read',
  'reference:write',
  'accounts:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value)
