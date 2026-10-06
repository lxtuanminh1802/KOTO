import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Case, Video } from './lib/types'
import { getSession, onSession, type Session } from './lib/api'
import { player } from './lib/player'
import { qc, useCases, useVideos } from './lib/queries'
import { connectRealtime, disconnectRealtime } from './lib/realtime'
import { closeModal, openModal, useUI } from './lib/store'
import Assistant from './components/Assistant'
import Header, { lockSession, MobileNav } from './components/Header'
import { AlertStack, LockScreen, Tour } from './components/Overlays'
import Sidebar, { isLive } from './components/Sidebar'
import { Toasts, TooltipLayer } from './components/ui'
import { DeleteVideoDialog, CoordDialog, EditCaseDialog, ExportedDialog, NewCaseDialog, ReanalyzeDialog, SettingsDialog, ShortcutsDialog, WelcomeDialog } from './dialogs/Basic'
import { AdminDialog, PackageDialog, PdfDialog } from './dialogs/Exports'
import { DetailDialog, WatchlistDialog, ZoneDialog } from './dialogs/Feature'
import UploadDialog from './dialogs/UploadDialog'
import CaseView from './views/CaseView'
import FootageView from './views/FootageView'
import ImageLabView from './views/ImageLabView'
import Login from './views/Login'
import MapView from './views/MapView'
import SearchView from './views/SearchView'
import TagsView from './views/TagsView'

const NONE: Case[] = []
const NONE_V: Video[] = []

const MODALS: Record<string, (p: any) => React.ReactNode> = {
  newCase: () => <NewCaseDialog />, editCase: p => <EditCaseDialog {...p} />, upload: p => <UploadDialog {...p} />, reanalyze: p => <ReanalyzeDialog {...p} />,
  deleteVideo: p => <DeleteVideoDialog {...p} />, settings: () => <SettingsDialog />, shortcuts: () => <ShortcutsDialog />, welcome: () => <WelcomeDialog />,
  exported: p => <ExportedDialog {...p} />, coord: p => <CoordDialog {...p} />, watchlist: p => <WatchlistDialog {...p} />, zone: () => <ZoneDialog />,
  detail: p => <DetailDialog {...p} />, pdf: p => <PdfDialog {...p} />, package: p => <PackageDialog {...p} />, admin: () => <AdminDialog />,
}

export default function App() {
  const [session, setS] = useState<Session | null>(getSession())
  const theme = useUI(s => s.theme)
  const lang = useUI(s => s.lang)
  useEffect(() => { const off = onSession(setS); return () => { off() } }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.lang = lang
  }, [theme, lang])
  useEffect(() => {
    if (!session) return
    useUI.setState({ theme: session.user.settings.theme, lang: session.user.settings.lang })
    connectRealtime()
    return () => disconnectRealtime()
  }, [session?.access ? session.user.id : null])
  useEffect(() => { if (!session) { qc.clear(); useUI.setState({ caseId: null, videoId: null, checked: {}, modal: null, alerts: [], aiOpen: false, tour: -1 }) } }, [!!session])
  if (!session) return <><Login /><Toasts /></>
  return <Shell />
}

function Shell() {
  const { tab, modal, locked, tour, caseId, set } = useUI(useShallow(s => ({ tab: s.tab, modal: s.modal, locked: s.locked, tour: s.tour, caseId: s.caseId, set: s.set })))
  const { data: cases = NONE } = useCases()
  const { data: videos = NONE_V } = useVideos()

  // Default case and scope: originals ticked, clips not (UR-SRCH-01).
  useEffect(() => {
    if (!caseId && cases.length) set({ caseId: (cases.find(c => c.lead_user_id === getSession()?.user.id) || cases[0]).id })
  }, [cases, caseId, set])
  useEffect(() => {
    const fresh = videos.filter(v => isLive(v) && !(v.id in useUI.getState().checked))
    if (fresh.length) set(s => ({ checked: { ...s.checked, ...Object.fromEntries(fresh.map(v => [v.id, !v.parent_id])) } }))
  }, [videos, set])
  // Switching case opens its first video (UR-CASE-06).
  useEffect(() => {
    if (!caseId || !videos.length) return
    const cur = videos.find(v => v.id === useUI.getState().videoId)
    if (cur?.case_id !== caseId) {
      const first = videos.find(v => v.case_id === caseId && !v.parent_id && isLive(v))
      if ((first?.id || null) !== useUI.getState().videoId) set({ videoId: first?.id || null, t: 0, inT: null, outT: null, focusDet: null })
    }
  }, [caseId, videos, set])
  // First sign-in welcome (UR-HELP-01), stored server-side.
  useEffect(() => { if (!getSession()?.user.welcome_seen) setTimeout(() => openModal('welcome'), 500) }, [])

  // Auto-lock after inactivity (UR-AUTH-02).
  useEffect(() => {
    let last = Date.now()
    const bump = () => { last = Date.now() }
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove']
    evs.forEach(e => addEventListener(e, bump, { passive: true }))
    const id = setInterval(() => {
      const mins = getSession()?.user.settings.idle_lock_minutes || 10
      if (!useUI.getState().locked && Date.now() - last > mins * 60000 && !useUI.getState().playing) lockSession()
    }, 15000)
    return () => { evs.forEach(e => removeEventListener(e, bump)); clearInterval(id) }
  }, [])

  // Keyboard shortcuts (UR-VID-05): never while typing, in a dialog, locked, or during the tour.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const s = useUI.getState()
      if (s.locked || s.tour >= 0) return
      const el = e.target as HTMLElement
      if (e.key === 'Escape') {
        if (s.modal) return closeModal()
        if (s.aiOpen) return set({ aiOpen: false })
        return set({ sidebarOpen: false, filterOpen: false, labPanelOpen: false })
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || s.modal) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '/') { e.preventDefault(); set({ aiOpen: true }); return }
      if (e.key === '?') { e.preventDefault(); openModal('shortcuts'); return }
      if (s.tab !== 'footage' || !player.current) return
      if (e.key === ' ' && el.tagName === 'BUTTON') return
      const k = e.key.toLowerCase()
      if (e.key === ' ') { e.preventDefault(); player.current.toggle() }
      else if (e.key === 'ArrowLeft' && !el.closest('[role=slider]')) { e.preventDefault(); player.current.seekRel(e.shiftKey ? -1 : -5) }
      else if (e.key === 'ArrowRight' && !el.closest('[role=slider]')) { e.preventDefault(); player.current.seekRel(e.shiftKey ? 1 : 5) }
      else if (k === 'i') player.current.markIn()
      else if (k === 'o') player.current.markOut()
      else if (k === 'b') player.current.bookmark()
      else if (k === 's') player.current.snapshot()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [set])

  return (
    <div className="h-full flex flex-col">
      <Header />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 relative overflow-hidden pb-16 lg:pb-0">
          {tab === 'case' && <CaseView />}
          {tab === 'footage' && <FootageView />}
          {tab === 'report' && <SearchView />}
          {tab === 'tags' && <TagsView />}
          {tab === 'map' && <MapView />}
          {tab === 'image' && <ImageLabView />}
        </main>
      </div>
      <MobileNav />
      <Assistant />
      {modal && MODALS[modal.kind]?.(modal.props || {})}
      <AlertStack />
      <Toasts />
      <TooltipLayer />
      {tour >= 0 && <Tour />}
      {locked && <LockScreen />}
    </div>
  )
}
