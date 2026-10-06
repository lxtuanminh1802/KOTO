import { getSession } from './api'
import type { Case } from './types'

/** Mirrors the API's RBAC (the API stays the authority, NFR-SEC-01). Lead-only actions need the user to lead the case. */
const LEAD_ONLY = new Set(['case.edit', 'evidence.remove', 'package'])
const WRITE = new Set(['video.upload', 'video.edit', 'zone', 'tag'])

export function can(action: string, c?: Case | null) {
  const me = getSession()?.user
  if (!me || !me.permissions.includes(action)) return false
  if (c && me.role === 'INVESTIGATOR' && LEAD_ONLY.has(action) && c.lead_user_id !== me.id) return false
  if (c && c.status === 'CLOSED' && WRITE.has(action)) return false
  return true
}
