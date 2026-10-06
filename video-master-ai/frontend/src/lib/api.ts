import type { Me } from './types'

/** Tokens live in sessionStorage: a closed tab ends the session; a reload keeps it (UR-AUTH-03). */
const KEY = 'vma.session'

export interface Session {
  access: string
  refresh: string
  media: string
  expires_at: string
  user: Me
}

let session: Session | null = (() => {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
})()

const listeners = new Set<(s: Session | null) => void>()

export function getSession() {
  return session
}

export function setSession(s: Session | null) {
  session = s
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: keep the session in memory only */
  }
  listeners.forEach(fn => fn(s))
}

export function onSession(fn: (s: Session | null) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export class ApiError extends Error {
  status: number
  code: string
  vi: string
  en: string
  extra: Record<string, unknown>
  constructor(status: number, detail: any) {
    const d = typeof detail === 'object' && detail ? detail : { code: 'error', vi: String(detail || 'Lỗi không xác định'), en: String(detail || 'Unknown error') }
    super(d.vi)
    this.status = status
    this.code = d.code || 'error'
    this.vi = d.vi || d.code
    this.en = d.en || this.vi
    this.extra = d
  }
  msg(lang: 'vi' | 'en') {
    return lang === 'vi' ? this.vi : this.en
  }
}

/** Backend origin when the web app is hosted apart from the API (e.g. Vercel). Empty = same origin. */
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
const abs = (path: string) => (path.startsWith('/api') ? API_BASE + path : path)

let refreshing: Promise<boolean> | null = null

async function refresh(): Promise<boolean> {
  if (!session) return false
  refreshing ??= (async () => {
    try {
      const r = await fetch(abs('/api/auth/refresh'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: session!.refresh }) })
      if (!r.ok) return false
      const j = await r.json()
      setSession({ ...session!, access: j.access, media: j.media })
      return true
    } catch {
      return false
    } finally {
      setTimeout(() => (refreshing = null), 0)
    }
  })()
  return refreshing
}

type Body = BodyInit | Record<string, unknown> | unknown[] | null | undefined

export async function api<T = any>(path: string, opts: { method?: string; body?: Body; query?: Record<string, string | number>; raw?: boolean } = {}): Promise<T> {
  const url = abs(path) + (opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)])).toString() : '')
  const isForm = opts.body instanceof FormData || opts.body instanceof Blob || opts.body instanceof ArrayBuffer
  const send = () =>
    fetch(url, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { ...(session ? { Authorization: `Bearer ${session.access}` } : {}), ...(opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body === undefined ? undefined : isForm ? (opts.body as BodyInit) : JSON.stringify(opts.body),
    })
  let r = await send()
  if (r.status === 401 && session && !path.startsWith('/api/auth/')) {
    if (await refresh()) r = await send()
  }
  if (!r.ok) {
    let detail: any = null
    try {
      detail = (await r.json()).detail
    } catch {
      /* not JSON */
    }
    const err = new ApiError(r.status, detail)
    if (r.status === 401 && (err.code === 'auth.expired' || err.code === 'pin.forced_logout' || err.code === 'auth.inactive')) setSession(null)
    throw err
  }
  if (opts.raw) return r as unknown as T
  const ct = r.headers.get('content-type') || ''
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>
}

/** Media URLs (<video>, <img>, downloads) carry the media token in the query string. */
export function media(path: string | null | undefined, extra: Record<string, string | number> = {}) {
  if (!path) return ''
  const q = new URLSearchParams({ token: session?.media || '', ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) })
  return `${abs(path)}${path.includes('?') ? '&' : '?'}${q}`
}
