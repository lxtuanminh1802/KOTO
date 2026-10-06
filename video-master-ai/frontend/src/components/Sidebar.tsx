import { useMemo, useRef, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { fmt, norm } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, refreshCase, useCases, useVideos, useWatch } from '../lib/queries'
import { openModal, toast, useUI } from '../lib/store'
import type { Case, Video } from '../lib/types'
import { FileName, Icon, MenuButton, VideoTag } from './ui'

export const isLive = (v: Video) => v.state !== 'REMOVED' && v.state !== 'REJECTED'

/** Case tree: case → original video → clips (UR-CASE-02). Ticks define the search scope (UR-SRCH-01). */
export default function Sidebar() {
  const { t, L } = useT()
  const { data: cases = EMPTY } = useCases()
  const { data: videos = EMPTY } = useVideos()
  const { data: watch } = useWatch()
  const { caseId, videoId, checked, closedCases, sidebarOpen, set } = useUI()
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)

  const byCase = useMemo(() => {
    const m: Record<string, { roots: Video[]; clips: Record<string, Video[]> }> = {}
    for (const v of videos.filter(isLive)) {
      const e = (m[v.case_id] ||= { roots: [], clips: {} })
      if (v.parent_id) (e.clips[v.parent_id] ||= []).push(v)
      else e.roots.push(v)
    }
    return m
  }, [videos])

  const nq = norm(q.trim())
  const hit = (v: Video, c: Case) => !nq || norm(`${v.name} ${v.camera_id} ${v.evidence_id || ''} ${c.code} ${c.title}`).includes(nq)
  const caseVids = (c: Case) => {
    const e = byCase[c.id]
    return e ? e.roots.flatMap(v => [v, ...(e.clips[v.id] || [])]) : []
  }
  const tick = (c: Case) => {
    const vs = caseVids(c)
    const n = vs.filter(v => checked[v.id]).length
    return !vs.length || !n ? 'none' : n === vs.length ? 'all' : 'some'
  }
  const watchCount = (watch?.faces.length || 0) + (watch?.plates.length || 0)

  return (
    <>
      <aside id="sidebar" aria-label={L('Vụ án và video', 'Cases and videos')}
        className={`fixed inset-y-0 left-0 z-50 w-[min(300px,88vw)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:static lg:translate-x-0 lg:z-auto lg:w-[280px] shrink-0 flex flex-col bg-surface border-r border-line transition-transform duration-300`}>
        <div className="p-4 space-y-3 border-b border-line">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">{t('casesTitle')}</h2>
            <button className="icon-btn lg:hidden -mr-2" aria-label={t('close')} onClick={() => set({ sidebarOpen: false })}><Icon name="x" /></button>
          </div>
          {can('case.create') && (
            <button id="newCaseBtn" className="btn btn-primary w-full" data-tip={t('tipNewCase')} onClick={() => openModal('newCase')}><Icon name="folder-plus" />{t('addCase')}</button>
          )}
          <div className="relative">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm" />
            <input type="search" className="inp pl-9" placeholder={t('searchPh')} aria-label={t('searchPh')} value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </div>
        <div id="caseList" className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
          {cases.map(c => {
            const e = byCase[c.id] || { roots: [], clips: {} }
            const shown = e.roots.filter(v => hit(v, c) || (e.clips[v.id] || []).some(k => hit(k, c)))
            if (nq && !shown.length && !norm(`${c.code} ${c.title}`).includes(nq)) return null
            const nClips = Object.values(e.clips).reduce((a, x) => a + x.length, 0)
            const active = c.id === caseId
            const open = !closedCases[c.id]
            const tri = tick(c)
            return (
              <section key={c.id} className={`rounded-lg ${active ? 'bg-subtle/70' : ''}`}>
                <div className="group/case flex items-center gap-1 pl-3 pr-1">
                  <input type="checkbox" className="w-4 h-4 shrink-0 cursor-pointer accent-[rgb(var(--accent))]" checked={tri === 'all'}
                    ref={el => { if (el) el.indeterminate = tri === 'some' }}
                    aria-label={`${L('Chọn mọi video của', 'Select every video in')} ${c.code}`} data-tip={L('Chọn hoặc bỏ chọn mọi video và đoạn cắt của vụ án', 'Select or clear every video and clip in the case')}
                    onChange={() => { const on = tri !== 'all'; set(s => ({ checked: { ...s.checked, ...Object.fromEntries(caseVids(c).map(v => [v.id, on])) } })) }} />
                  <button className="flex-1 min-w-0 flex items-center gap-2 h-10 px-1.5 rounded-md hover:bg-subtle text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                    aria-expanded={open} title={`${c.code} ${c.title}`}
                    onClick={() => set(s => ({ closedCases: { ...s.closedCases, [c.id]: open }, caseId: c.id }))}>
                    <Icon name={open ? 'folder-open' : 'folder'} className={`text-base ${active ? 'text-accent' : 'text-muted'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold truncate leading-4">{c.title}</span>
                      <span className="block font-mono text-2xs text-muted mt-0.5">{c.code}{c.status === 'CLOSED' ? ` · ${L('Đã kết thúc', 'Closed')}` : ''}</span>
                    </span>
                    <span className="text-2xs text-muted tabular shrink-0" title={L(`${e.roots.length} video gốc, ${nClips} đoạn cắt`, `${e.roots.length} originals, ${nClips} clips`)}>{e.roots.length}{nClips ? `+${nClips}` : ''}</span>
                  </button>
                  {can('video.upload', c) && (
                    <button className={`icon-btn-sm shrink-0 ${active ? '' : 'lg:opacity-0 group-hover/case:opacity-100 focus:opacity-100'}`} data-upload-case={c.id}
                      aria-label={`${t('tipUploadTo')} ${c.code}`} data-tip={t('tipUploadTo')} onClick={() => openModal('upload', { caseId: c.id })}><Icon name="upload" className="text-sm" /></button>
                  )}
                </div>
                {open && (
                  <ul className="pb-1 space-y-px">
                    {shown.map(v => [
                      <VideoRow key={v.id} v={v} c={c} active={v.id === videoId} renaming={renaming === v.id} setRenaming={setRenaming} />,
                      ...(e.clips[v.id] || []).map(k => <VideoRow key={k.id} v={k} c={c} active={k.id === videoId} renaming={renaming === k.id} setRenaming={setRenaming} />),
                    ])}
                    {!shown.length && (e.roots.length ? <li className="px-3 py-2 text-xs text-muted">{t('noVideo')}</li> : can('video.upload', c) ? (
                      <li className="px-2 pb-2"><button className="btn btn-quiet w-full h-8 text-xs" onClick={() => openModal('upload', { caseId: c.id })}><Icon name="upload" />{L('Tải video đầu tiên', 'Upload first video')}</button></li>
                    ) : <li className="px-3 py-2 text-xs text-muted">{L('Chưa có video.', 'No video yet.')}</li>)}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
        <div className="p-3 border-t border-line space-y-1">
          <button className="btn btn-ghost w-full justify-start" onClick={() => openModal('watchlist')}>
            <Icon name="eye" /><span>{t('watchlist')}</span><span className="ml-auto tag bg-accent/10 text-accent">{watchCount}</span>
          </button>
          <button className="btn btn-ghost w-full justify-start" onClick={() => set({ tour: 0, sidebarOpen: false })}><Icon name="circle-help" /><span>{t('quickGuide')}</span></button>
        </div>
      </aside>
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => set({ sidebarOpen: false })} />}
    </>
  )
}

function VideoRow({ v, c, active, renaming, setRenaming }: { v: Video; c: Case; active: boolean; renaming: boolean; setRenaming: (id: string | null) => void }) {
  const { t, L } = useT()
  const { checked, overlayOff, set } = useUI()
  const clip = !!v.parent_id
  const done = v.state === 'ANALYZED'
  const failed = v.state === 'FAILED'
  const label = v.state === 'UPLOADING' ? L('Đang tải lên', 'Uploading') : v.state === 'HASHING' ? 'SHA-256…' : v.state === 'QUEUED' ? L('Chờ phân tích', 'Queued') : ''
  const select = () => set({ videoId: v.id, caseId: v.case_id, tab: 'footage', sidebarOpen: false, t: 0, inT: null, outT: null, focusDet: null, pendingSeek: { videoId: v.id, t: 0 } })

  return (
    <li className={`group relative flex items-center gap-2 ${clip ? 'pl-9' : 'pl-3'} pr-1 py-1.5 rounded-md ${active ? 'bg-subtle' : 'hover:bg-subtle/60'}`}>
      {clip && <span className="absolute left-[22px] top-0 h-1/2 w-3 border-l border-b border-line2 rounded-bl-sm" aria-hidden="true" />}
      <input type="checkbox" className="w-4 h-4 shrink-0 cursor-pointer accent-[rgb(var(--accent))]" checked={!!checked[v.id]}
        aria-label={`${L('Tìm trong', 'Search in')} ${v.name}`} data-tip={L('Tick để đưa video này vào Tìm đối tượng', 'Tick to include this video in Find subjects')}
        onChange={e => set(s => ({ checked: { ...s.checked, [v.id]: e.target.checked } }))} />
      {renaming ? (
        <RenameInput v={v} onDone={() => setRenaming(null)} />
      ) : (
        <button className="flex items-center gap-2 flex-1 min-w-0 text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer" aria-current={active || undefined} onClick={select}>
          {v.thumb_url ? <img src={media(v.thumb_url)} className={`${clip ? 'w-10 h-6' : 'w-12 h-7'} rounded-sm object-cover shrink-0 bg-black ${done ? '' : 'opacity-60'}`} alt="" />
            : <span className={`${clip ? 'w-10 h-6' : 'w-12 h-7'} rounded-sm shrink-0 bg-black/80 grid place-items-center text-white/60`}><Icon name="video" className="text-xs" /></span>}
          <span className="min-w-0 flex-1">
            <span className={`flex min-w-0 text-[12.5px] leading-4 ${active ? 'font-medium' : ''}`}><FileName name={v.name} clip={clip} /></span>
            <span className="flex items-center gap-1.5 mt-1 text-2xs text-muted min-w-0">
              <VideoTag clip={clip} />
              {v.alerts > 0 && <span className="tag bg-danger text-white"><Icon name="siren" className="text-[10px]" />{v.alerts}</span>}
              {v.integrity === 'MISMATCH' && <span className="tag bg-danger/10 text-danger">{L('Lệch', 'Mismatch')}</span>}
              {done ? <span className="truncate font-mono">{clip ? `${fmt(v.clip_start || 0)}–${fmt(v.clip_end || 0)}` : v.evidence_id}</span>
                : failed ? <span className="text-danger truncate">{L('Lỗi', 'Failed')}</span>
                : v.state === 'ANALYZING' ? <>
                    <span className="flex-1 h-0.5 rounded-full bg-line overflow-hidden"><span className="block h-full bg-accent transition-all" style={{ width: `${v.progress}%` }} /></span>
                    <span className="tabular">{Math.floor(v.progress)}%</span></>
                : <span className="truncate">{label}</span>}
            </span>
          </span>
        </button>
      )}
      <MenuButton className="icon-btn-sm w-6 h-6 opacity-100 lg:opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0" label={t('more')}
        items={[
          { icon: 'pencil', label: t('rename'), onClick: () => setRenaming(v.id), hidden: !can('video.edit', c) },
          { icon: 'refresh', label: t('reprocess'), onClick: () => openModal('reanalyze', { video: v }), hidden: clip || !can('video.upload', c) || !['ANALYZED', 'FAILED'].includes(v.state) },
          { icon: 'funnel', label: t('videoReport'), onClick: () => set(s => ({ checked: Object.fromEntries(Object.keys(s.checked).map(k => [k, k === v.id])), tab: 'report', sidebarOpen: false })), hidden: !done },
          { icon: overlayOff[v.id] ? 'eye' : 'eye-off', label: t(overlayOff[v.id] ? 'overlayOff' : 'overlayOn'), onClick: () => set(s => ({ overlayOff: { ...s.overlayOff, [v.id]: !s.overlayOff[v.id] } })) },
          { icon: 'trash', label: t('delete'), onClick: () => openModal('deleteVideo', { video: v }), danger: true, hidden: !can('evidence.remove', c) },
        ]}>
        <Icon name="ellipsis" />
      </MenuButton>
    </li>
  )
}

/** UR-EVD-11: Enter saves, Esc cancels, leaving the field saves. */
function RenameInput({ v, onDone }: { v: Video; onDone: () => void }) {
  const { lang } = useT()
  const [val, setVal] = useState(v.name)
  const done = useRef(false)
  const commit = async (save: boolean) => {
    if (done.current) return
    done.current = true
    onDone()
    if (!save || !val.trim() || val.trim() === v.name) return
    try {
      await api(`/api/videos/${v.id}`, { method: 'PATCH', body: { name: val.trim() } })
      toast(lang === 'vi' ? 'Đã đổi tên' : 'Renamed', 'success')
      refreshCase()
    } catch (e) {
      if (e instanceof ApiError) toast(e.msg(lang), 'error')
    }
  }
  return (
    <input autoFocus className="flex-1 min-w-0 h-7 px-2 rounded bg-surface border border-accent text-sm outline-none" value={val} onChange={e => setVal(e.target.value)}
      onFocus={e => e.target.select()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false) }} onBlur={() => commit(true)} />
  )
}
