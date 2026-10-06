import { useState } from 'react'
import { api, getSession, setSession } from '../lib/api'
import { hms } from '../lib/format'
import { useT, type TKey } from '../lib/i18n'
import { EMPTY, qc, useNotifications } from '../lib/queries'
import { gotoVideo, openModal, useUI, type Tab } from '../lib/store'
import type { Notification } from '../lib/types'
import { Icon, MenuButton, Popover } from './ui'

export const NAV: [Tab, string, TKey, TKey][] = [
  ['case', 'folder-open', 'caseTab', 'caseShort'],
  ['footage', 'circle-play', 'footage', 'footageShort'],
  ['report', 'search', 'report', 'reportShort'],
  ['tags', 'bookmark', 'tags', 'tagsShort'],
  ['map', 'map', 'map', 'map'],
  ['image', 'image', 'image', 'imageShort'],
]

export function ago(iso: string, t: (k: TKey, v?: Record<string, string | number>) => string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return t('justNow')
  if (m < 60) return t('minAgo', { n: m })
  if (m < 1440) return t('hrAgo', { n: Math.floor(m / 60) })
  return t('dayAgo', { n: Math.floor(m / 1440) })
}

const TONE: Record<string, string> = { ok: 'bg-ok/10 text-ok', warn: 'bg-warn/10 text-warn', accent: 'bg-accent/10 text-accent', danger: 'bg-danger/10 text-danger' }
const KIND_ICON: Record<string, string> = { watch: 'siren', analysis_done: 'circle-check', report: 'file-down', multi_camera: 'route', shared: 'folder-open', integrity: 'shield-alert', enhance_done: 'wand' }

export function followNotification(n: Notification) {
  const s = useUI.getState()
  if (n.unread) api(`/api/notifications/${n.id}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
  const l = n.link || {}
  if (l.download) window.open(`${l.download}?token=${encodeURIComponent(getSession()?.media || '')}`, '_blank')
  else if (l.map) s.set({ tab: 'map', selectedTrack: l.map })
  else if (l.video) gotoVideo(l.video, l.t || 0, l.alert || null)
  else if (l.case) s.set({ caseId: l.case, tab: 'case' })
  else if (l.tab) s.set({ tab: l.tab as Tab })
}

function Notifications() {
  const { t, lang } = useT()
  const { data = EMPTY } = useNotifications()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const unread = data.filter(n => n.unread).length
  const readAll = async () => {
    await api('/api/notifications/read-all', { method: 'POST' })
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }
  return (
    <>
      <button className="icon-btn relative" id="notifBtn" aria-haspopup="true" aria-expanded={!!anchor} aria-label={`${t('notifs')}${unread ? ` (${unread})` : ''}`} data-tip={t('tipNotif')}
        onClick={e => setAnchor(anchor ? null : e.currentTarget)}>
        <Icon name="bell" />
        {unread > 0 && <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold leading-4 text-center tabular ring-2 ring-surface">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={380}>
          <div className="flex items-center justify-between h-12 px-4 border-b border-line">
            <p className="text-sm font-semibold">{t('notifs')}</p>
            {unread > 0 && <button className="text-xs text-muted hover:text-fg cursor-pointer" onClick={readAll}>{t('markRead')}</button>}
          </div>
          <ul className="max-h-[min(60vh,440px)] overflow-y-auto py-1" role="menu">
            {data.length ? data.map(n => (
              <li key={n.id}>
                <button role="menuitem" className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none cursor-pointer"
                  onClick={() => { setAnchor(null); followNotification(n) }}>
                  <span className={`w-8 h-8 rounded-full grid place-items-center shrink-0 text-sm ${TONE[n.tone] || TONE.accent}`}><Icon name={KIND_ICON[n.kind] || 'info'} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-5 ${n.unread ? 'font-medium' : 'text-muted'}`}>{lang === 'vi' ? n.title_vi : n.title_en}</span>
                    <span className="block text-xs text-muted truncate">{lang === 'vi' ? n.body_vi : n.body_en}</span>
                    <span className="block text-[11px] text-muted mt-1" title={hms(n.at)}>{ago(n.at, t)}</span>
                  </span>
                  {n.unread && <span className="w-2 h-2 rounded-full bg-accent mt-2 shrink-0"><span className="sr-only">unread</span></span>}
                </button>
              </li>
            )) : <li className="px-4 py-8 text-center text-sm text-muted">{t('noNotifs')}</li>}
          </ul>
        </Popover>
      )}
    </>
  )
}

export async function saveSetting(patch: Record<string, unknown>) {
  const s = getSession()
  if (!s) return
  const settings = await api('/api/me/settings', { method: 'PUT', body: patch })
  setSession({ ...s, user: { ...s.user, settings } })
}

export async function lockSession() {
  useUI.setState({ locked: true, playing: false, modal: null, aiOpen: false, sidebarOpen: false, filterOpen: false, labPanelOpen: false })
  api('/api/auth/lock', { method: 'POST' }).catch(() => {})
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
  setSession(null)
  qc.clear()
}

export default function Header() {
  const { t, L, lang } = useT()
  const { tab, theme, aiOpen, set } = useUI()
  const me = getSession()!.user
  const initials = me.full_name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()
  return (
    <header className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-line bg-surface z-30">
      <button className="icon-btn lg:hidden -ml-2" aria-label={t('casesTitle')} onClick={() => set({ sidebarOpen: true })}><Icon name="menu" /></button>
      <button className="flex items-center gap-2.5 shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer" aria-label="Video Master AI, AIPT Group" onClick={() => set({ tab: 'case' })}>
        <span className="h-8 px-1.5 rounded-md bg-white ring-1 ring-line grid place-items-center shrink-0"><img src="/aipt-logo.png" alt="" className="h-6 w-auto" /></span>
        <span className="hidden sm:flex items-baseline gap-1 text-[15px] font-bold tracking-tight">Video Master<span className="text-accent">AI</span></span>
      </button>
      <nav role="tablist" aria-label={L('Chức năng chính', 'Main functions')} className="hidden lg:flex items-center gap-1 ml-4">
        {NAV.map(([k, icon, label]) => (
          <button key={k} className="nav-tab" role="tab" aria-selected={tab === k} data-nav={k} onClick={() => set({ tab: k })}><Icon name={icon} />{t(label)}</button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <MenuButton className="btn btn-ghost px-2.5" label={t('help')} tip={t('tipHelp')}
          items={[
            { icon: 'pointer', label: L('Hướng dẫn từng bước', 'Guided tour'), onClick: () => set({ tour: 0 }) },
            { icon: 'lightbulb', label: L('Giới thiệu 4 bước xử lý', 'The 4-step flow'), onClick: () => openModal('welcome') },
            { icon: 'keyboard', label: t('shortcuts'), onClick: () => openModal('shortcuts') },
          ]}>
          <span id="helpBtn" className="contents"><Icon name="circle-help" /><span className="hidden xl:inline">{t('help')}</span></span>
        </MenuButton>
        <button id="aiToggle" className="btn btn-quiet" aria-expanded={aiOpen} data-tip={t('tipAi')} onClick={() => set({ aiOpen: !aiOpen })}>
          <Icon name="wand" className="text-accent" /><span className="hidden sm:inline">{t('assistant')}</span>
        </button>
        <Notifications />
        <MenuButton className="ml-1 w-9 h-9 rounded-full bg-accent text-accent-fg grid place-items-center text-xs font-bold transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 cursor-pointer"
          label={`${L('Tài khoản', 'Account')}: ${me.full_name}`} tip={t('tipUser')} width={260}
          header={
            <div className="px-4 py-3 border-b border-line">
              <p className="text-sm font-semibold">{me.full_name}</p>
              <p className="text-xs text-muted mt-0.5">{me.title}{me.unit ? `, ${me.unit}` : ''}</p>
              <p className="flex items-center gap-1 mt-2 text-[11px] text-ok"><Icon name="shield-check" className="text-xs" />{t('verified')}</p>
            </div>
          }
          items={[
            { icon: 'settings', label: t('settings'), onClick: () => openModal('settings') },
            { icon: theme === 'dark' ? 'sun' : 'moon', label: theme === 'dark' ? L('Giao diện sáng', 'Light theme') : L('Giao diện tối', 'Dark theme'),
              onClick: () => { const v = theme === 'dark' ? 'light' : 'dark'; set({ theme: v }); saveSetting({ theme: v }) } },
            { icon: 'globe', label: lang === 'vi' ? 'English' : 'Tiếng Việt', onClick: () => { const v = lang === 'vi' ? 'en' : 'vi'; set({ lang: v }); saveSetting({ lang: v }) } },
            { icon: 'keyboard', label: t('shortcuts'), onClick: () => openModal('shortcuts') },
            { icon: 'users', label: L('Quản lý người dùng', 'User management'), onClick: () => openModal('admin'), hidden: !me.permissions.includes('admin') },
            { icon: 'lock', label: t('lock'), onClick: lockSession },
            { icon: 'log-out', label: t('logout'), onClick: logout, danger: true },
          ]}>
          {initials}
        </MenuButton>
      </div>
    </header>
  )
}

export function MobileNav() {
  const { t } = useT()
  const { tab, set } = useUI()
  return (
    <nav role="tablist" className="lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 grid grid-cols-6 bg-surface border-t border-line" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {NAV.map(([k, icon, , short]) => (
        <button key={k} className="mnav" role="tab" aria-selected={tab === k} onClick={() => set({ tab: k })}><Icon name={icon} className="text-lg" /><span>{t(short)}</span></button>
      ))}
    </nav>
  )
}
