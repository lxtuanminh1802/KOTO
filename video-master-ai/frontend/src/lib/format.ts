/** Times are stored in UTC and shown in GMT+7 (NFR-INT-02). */
const TZ = 'Asia/Ho_Chi_Minh'
const pad = (n: number) => String(n).padStart(2, '0')

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export const fmt = (s: number) => {
  s = Math.max(0, Math.floor(s || 0))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

function parts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(d)
      .map(x => [x.type, x.value]),
  )
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === '24' ? '00' : p.hour, mi: p.minute, s: p.second }
}

export const toDate = (iso: string | Date) => (iso instanceof Date ? iso : new Date(iso))
export const hms = (iso: string | Date) => {
  const p = parts(toDate(iso))
  return `${p.h}:${p.mi}:${p.s}`
}
export const dmy = (iso: string | Date) => {
  const p = parts(toDate(iso))
  return `${p.d}/${p.mo}/${p.y}`
}
export const stamp = (iso: string | Date) => {
  const p = parts(toDate(iso))
  return `${p.d}/${p.mo} ${p.h}:${p.mi}:${p.s}`
}
export const absAt = (startIso: string, sec: number) => new Date(new Date(startIso).getTime() + sec * 1000)

/** datetime-local value (GMT+7 wall clock) <-> UTC ISO */
export const localInputToIso = (v: string) => (v ? new Date(v + '+07:00').toISOString() : '')
export const isoToLocalInput = (iso: string) => {
  if (!iso) return ''
  const p = parts(new Date(iso))
  return `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}:${p.s}`
}

export const shortHash = (h?: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '')
export const fmtSize = (b: number) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB')

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')

export const isDarkHex = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 150
}

export function copyText(text: string) {
  return navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.append(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  })
}
