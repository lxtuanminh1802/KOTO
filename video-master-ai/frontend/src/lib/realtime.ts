import { API_BASE, getSession } from './api'
import { translate } from './i18n'
import { qc } from './queries'
import { toast, useUI } from './store'
import type { Notification, Video } from './types'
import type { AlertCard } from './store'

/** WebSocket client: progress, early watchlist alerts, notifications (UR-ANA-01, UR-WATCH-04, UR-NOTI-01). */
let ws: WebSocket | null = null
let timer: number | undefined
let stopped = false
const lastState: Record<string, string> = {}

export function connectRealtime() {
  stopped = false
  const s = getSession()
  if (!s) return
  const origin = API_BASE ? new URL(API_BASE) : location
  const proto = origin.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${origin.host}/api/ws?token=${encodeURIComponent(s.media)}`)
  const ping = window.setInterval(() => ws?.readyState === 1 && ws.send('ping'), 25_000)
  ws.onmessage = e => handle(JSON.parse(e.data))
  ws.onclose = () => {
    clearInterval(ping)
    if (!stopped) timer = window.setTimeout(connectRealtime, 3000)
  }
}

export function disconnectRealtime() {
  stopped = true
  clearTimeout(timer)
  ws?.close()
  ws = null
}

let pending = false
function invalidateSoon(keys: string[]) {
  if (pending) return
  pending = true
  setTimeout(() => {
    pending = false
    keys.forEach(k => qc.invalidateQueries({ queryKey: [k] }))
  }, 400)
}

const shownAlerts = new Set<string>()

/** At most three cards; the oldest is replaced (UR-WATCH-04). One card per detection. */
export function pushAlert(card: AlertCard) {
  if (shownAlerts.has(card.detection_id)) return
  shownAlerts.add(card.detection_id)
  useUI.setState(s => ({ alerts: [...s.alerts, card].slice(-3) }))
}

/** Alerts raised while this browser was offline still get a card if they are recent and unread. */
export function showMissedAlerts(list: Notification[], lang: 'vi' | 'en') {
  for (const n of list) {
    const l = n.link as any
    if (n.kind !== 'watch' || !n.unread || !l?.alert || Date.now() - new Date(n.at).getTime() > 15 * 60000) continue
    const t = l.t || 0
    pushAlert({ id: n.id, detection_id: l.alert, video_id: l.video, t, label: (lang === 'vi' ? l.label_vi : l.label_en) || n.title_vi,
      similarity: Math.round(l.sim || 100), where: `${l.ev || ''} · ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`, note: l.note || '' })
  }
}

function handle(msg: any) {
  const lang = useUI.getState().lang
  switch (msg.type) {
    case 'progress':
    case 'video': {
      qc.setQueryData<Video[]>(['videos'], old => old?.map(v => (v.id === msg.video_id ? { ...v, progress: msg.progress, state: msg.state } : v)))
      const prev = lastState[msg.video_id]
      lastState[msg.video_id] = msg.state
      if (msg.type === 'video' || prev !== msg.state) {
        invalidateSoon(['videos', 'overview', 'tracks', 'search', 'zones'])
        qc.invalidateQueries({ queryKey: ['detections', msg.video_id] })
      } else if (useUI.getState().tab === 'case') {
        qc.setQueryData<any>(['overview', msg.case_id], (old: any) =>
          old ? { ...old, videos: old.videos.map((v: Video) => (v.id === msg.video_id ? { ...v, progress: msg.progress, state: msg.state } : v)) } : old,
        )
      }
      break
    }
    case 'audit':
      if (msg.case_id) invalidateSoon(['overview'])
      break
    case 'notification':
      qc.invalidateQueries({ queryKey: ['notifications'] })
      if (msg.kind === 'analysis_done' && useUI.getState().locked === false) {
        qc.fetchQuery({ queryKey: ['notifications'] }).then((list: any) => {
          const n = list?.find((x: any) => x.id === msg.id)
          const me = getSession()?.user
          if (n && me?.settings.notify !== false) toast(lang === 'vi' ? n.title_vi : n.title_en, 'success')
        })
      }
      break
    case 'watch_alert': {
      qc.invalidateQueries({ queryKey: ['detections', msg.video_id] })
      invalidateSoon(['videos'])
      const mm = Math.floor(msg.t / 60)
      const ss = Math.floor(msg.t % 60)
      const card = {
        id: msg.detection_id + Date.now(), detection_id: msg.detection_id, video_id: msg.video_id, t: msg.t, label: lang === 'vi' ? msg.label_vi : msg.label_en,
        similarity: Math.round(msg.similarity), where: `${msg.evidence_id} · ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, note: msg.note || '',
      }
      pushAlert(card)
      break
    }
    case 'enhance_done':
      toast(translate(lang, 'venhExport') + ' ✓', 'success')
      qc.invalidateQueries({ queryKey: ['notifications'] })
      break
  }
}
