import { useEffect, useRef, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { COLORS, labelOf } from '../lib/domain'
import { fmt, hms } from '../lib/format'
import { useT } from '../lib/i18n'
import { EMPTY, useCases, useSnapshots, useVideos } from '../lib/queries'
import { gotoVideo, useUI } from '../lib/store'
import type { ResultItem } from '../lib/types'
import { Icon } from './ui'

interface Reply {
  text: string
  items: ResultItem[]
  actions: { type: string; detection_id?: string; video_id?: string; t?: number; label?: string; q?: string }[]
  route?: { camera_id: string; time: string }[]
  plates?: { plate: string; confidence?: number; cameras?: string[]; multi?: boolean; id: string }[]
  tags?: { color: string; note: string; video_id: string; t: number }[]
  more?: number
}
interface Msg { q: string; r?: Reply; shown?: string }

/** UR-AI-01: a drawer that knows what you are looking at. */
export default function Assistant() {
  const { t, L, lang } = useT()
  const { aiOpen, aiPrefill, tab, caseId, videoId, lab, selectedTrack, set } = useUI()
  const { data: videos = EMPTY } = useVideos()
  const { data: snaps } = useSnapshots(caseId)
  const { data: cases = EMPTY } = useCases()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const v = videos.find(x => x.id === videoId)
  const snap = snaps?.snapshots.find(s => s.id === lab.snapId) || snaps?.snapshots[0]
  const ctx = tab === 'image' ? (snap?.video_id ? `${snap.camera_id}, ${L('khung', 'frame')} ${fmt(snap.t)}` : L('Ảnh tải lên', 'Uploaded image'))
    : tab === 'footage' && v ? `${v.camera_id}, ${fmt(useUI.getState().t)}` : `${L('Vụ án', 'Case')} ${cases.find(c => c.id === caseId)?.code || ''}`
  const SUGG: Record<string, string[]> = {
    case: [L('Tóm tắt vụ án', 'Summarize case'), L('Ai xuất hiện ở nhiều camera?', 'Who appears on several cameras?'), L('Liệt kê biển số', 'List plates')],
    footage: [L('Mô tả cảnh này', 'Describe this scene'), L('Đếm người', 'Count people'), L('Tóm tắt video', 'Summarize video'), L('Đọc dấu thời gian', 'Read timestamp')],
    image: [L('Mô tả ảnh', 'Describe image'), L('Đọc biển số', 'Read plates'), L('Đếm người', 'Count people')],
    report: [L('Tìm nam áo đen đeo ba lô', 'Find man in black with backpack'), L('Liệt kê biển số', 'List plates'), L('Ai xuất hiện ở nhiều camera?', 'Who appears on several cameras?')],
    map: [L('Lộ trình P01', 'Route of P01'), L('Ai xuất hiện ở nhiều camera?', 'Who appears on several cameras?')],
    tags: [L('Tóm tắt các thẻ', 'Summarize tags'), L('Lộ trình P01', 'Route of P01')],
  }

  const ask = async (text: string) => {
    text = text.trim()
    if (!text || busy || !caseId) return
    setBusy(true)
    setMsgs(m => [...m, { q: text }])
    try {
      const r = await api<Reply>('/api/assistant/ask', {
        body: { q: text, lang, tab, case_id: caseId, video_id: tab === 'footage' ? videoId : null, t: useUI.getState().t, snapshot_id: tab === 'image' ? snap?.id : null, track_id: selectedTrack },
      })
      setMsgs(m => m.map((x, i) => (i === m.length - 1 ? { ...x, r, shown: '' } : x)))
      let i = 0
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
      const step = () => {
        i = reduce ? r.text.length : Math.min(r.text.length, i + 4)
        setMsgs(m => m.map((x, j) => (j === m.length - 1 ? { ...x, shown: r.text.slice(0, i) } : x)))
        if (i < r.text.length) setTimeout(step, 14)
        else setBusy(false)
      }
      step()
    } catch (e) {
      setMsgs(m => m.map((x, i) => (i === m.length - 1 ? { ...x, r: { text: e instanceof ApiError ? e.msg(lang) : String(e), items: [], actions: [] }, shown: e instanceof ApiError ? e.msg(lang) : String(e) } : x)))
      setBusy(false)
    }
  }

  useEffect(() => { body.current?.scrollTo(0, body.current.scrollHeight) }, [msgs])
  useEffect(() => { if (aiOpen) setTimeout(() => input.current?.focus(), 250) }, [aiOpen])
  useEffect(() => {
    if (aiOpen && aiPrefill) { set({ aiPrefill: null }); ask(aiPrefill) }
  }, [aiOpen, aiPrefill])

  const act = (a: Reply['actions'][number], items: ResultItem[]) => {
    const d = items.find(x => x.id === a.detection_id)
    if (a.type === 'map' && a.detection_id) set({ tab: 'map', mapTab: d?.kind === 'vehicle' ? 'vehicle' : 'gait', selectedTrack: a.detection_id })
    if (a.type === 'view' && d) gotoVideo(d.video_id, d.t_in, d.id)
    if (a.type === 'seek' && a.video_id) gotoVideo(a.video_id, a.t || 0)
    if (a.type === 'apply' && a.q) api<any>('/api/search/parse', { body: { q: a.q } }).then(p => set({ filters: p.filters, reportTab: p.vehicle ? 'vehicle' : 'person', tab: 'report', searchMode: 'text' }))
  }
  const actLabel = (a: Reply['actions'][number]) => a.type === 'map' ? L('Xem trên bản đồ', 'Show on map') : a.type === 'view' ? t('viewInFootage') : a.type === 'seek' ? `${L('Đến đoạn đông nhất', 'Jump to busiest')} ${a.label}` : L('Mở trong Tìm đối tượng với bộ lọc này', 'Open in Find subjects with these filters')

  return (
    <aside id="assistant" aria-label={t('assistant')} aria-hidden={!aiOpen}
      className={`fixed top-0 right-0 bottom-0 z-[55] w-full sm:w-[400px] ${aiOpen ? 'translate-x-0 shadow-2xl' : 'translate-x-full invisible'} transition-[translate,visibility] duration-300 bg-surface border-l border-line flex flex-col`}>
      <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line">
        <Icon name="wand" className="text-accent" /><h2 className="text-sm font-semibold">{t('assistant')}</h2>
        <span className="min-w-0 truncate text-xs text-muted ml-2">{ctx}</span>
        <button className="icon-btn ml-auto" aria-label={L('Cuộc trò chuyện mới', 'New conversation')} title={L('Cuộc trò chuyện mới', 'New conversation')} onClick={() => setMsgs([])}><Icon name="square-pen" /></button>
        <button className="icon-btn -mr-2" aria-label={L('Đóng trợ lý', 'Close assistant')} onClick={() => set({ aiOpen: false })}><Icon name="x" /></button>
      </header>
      <div ref={body} className="flex-1 overflow-y-auto p-4 space-y-6" aria-live="polite">
        {!msgs.length && <div className="pt-2"><span className="w-9 h-9 rounded-md bg-accent/10 text-accent grid place-items-center text-base"><Icon name="sparkles" /></span><p className="text-sm text-muted leading-6 mt-4">{t('aiHello')}</p></div>}
        {msgs.map((m, i) => (
          <div key={i} className="space-y-4">
            <div className="flex justify-end fade-in"><p className="max-w-[85%] px-4 py-2 rounded-lg bg-subtle text-sm leading-6">{m.q}</p></div>
            <div className="fade-in">
              <p className="text-xs text-muted mb-1 flex items-center gap-1"><Icon name="wand" className="text-accent" />{t('assistant')}</p>
              {m.shown === undefined ? <p className="typing"><span /><span /><span /></p> : <p className="text-sm leading-6">{m.shown}</p>}
              {m.r && m.shown === m.r.text && <>
                {m.r.route && <ol className="mt-2 space-y-1 text-xs">{m.r.route.map((p, j) => <li key={j}><span className="font-mono">{hms(p.time)}</span> {p.camera_id}</li>)}</ol>}
                {m.r.plates && <ul className="mt-2 space-y-2">{m.r.plates.map(p => <li key={p.plate} className="flex items-center gap-2 text-xs"><span className="plate !text-xs">{p.plate}</span>
                  {p.confidence != null && <span className={p.confidence >= 70 ? 'text-ok' : 'text-warn'}>{p.confidence}%</span>}
                  {p.cameras && <span className="text-muted flex-1">{p.cameras.join(', ')}</span>}{p.multi && <span className="text-accent">{L('nhiều nơi', 'multi-site')}</span>}
                  {p.confidence != null && <button className="btn btn-quiet h-7 text-xs" onClick={() => set({ lab: { ...useUI.getState().lab, ocr: p.id, layers: { ...useUI.getState().lab.layers, plate: true } } })}>{L('Xem chi tiết', 'Details')}</button>}</li>)}</ul>}
                {m.r.tags && <ul className="mt-2 space-y-2 text-xs">{m.r.tags.map((tg, j) => <li key={j} className="flex gap-2"><span className="w-2 h-2 mt-1 rounded-full shrink-0" style={{ background: COLORS[tg.color]?.hex }} />
                  <span className="flex-1">{tg.note} <button className="font-mono underline underline-offset-2 cursor-pointer" onClick={() => gotoVideo(tg.video_id, tg.t)}>{fmt(tg.t)}</button></span></li>)}</ul>}
                {m.r.items.length > 0 && <div className="mt-2">{m.r.items.map(d => (
                  <button key={d.id} className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-subtle text-left cursor-pointer" onClick={() => gotoVideo(d.video_id, d.t_in, d.id)}>
                    <img src={media(d.kind === 'person' ? d.face_url || d.crop_url : d.crop_url)} className="w-8 h-8 rounded object-cover bg-black" alt="" />
                    <span className="min-w-0 flex-1"><span className="block text-xs font-medium truncate">{labelOf(d, lang)} · {d.evidence_id}</span><span className="block text-[11px] text-muted truncate">{d.camera_id}, {hms(d.abs_in)}</span></span>
                    <span className="text-[11px] text-muted tabular">{d.confidence}%</span></button>))}
                  {!!m.r.more && <p className="text-xs text-muted mt-1">{L(`và ${m.r.more} kết quả khác`, `and ${m.r.more} more`)}</p>}</div>}
                {m.r.actions.length > 0 && <div className="flex flex-wrap gap-2 mt-3">{m.r.actions.map((a, j) => <button key={j} className="btn btn-quiet h-8 text-xs" onClick={() => act(a, m.r!.items)}>{actLabel(a)}</button>)}</div>}
              </>}
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 pb-2 flex flex-wrap gap-2">{(SUGG[tab] || []).map(s => <button key={s} className="chip h-7 text-xs" onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="p-4 pt-2" onSubmit={e => { e.preventDefault(); ask(q); setQ('') }}>
        <div className="flex items-end gap-2 rounded-lg border border-line bg-bg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 p-2 transition">
          <textarea ref={input} rows={1} value={q} onChange={e => setQ(e.target.value)} className="flex-1 resize-none bg-transparent outline-none text-sm leading-6 max-h-32 px-1 placeholder:text-muted" placeholder={t('aiPh')} aria-label={L('Câu hỏi cho trợ lý', 'Question for the assistant')}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q); setQ('') } }} />
          <button type="submit" className="w-8 h-8 rounded-md bg-inverse text-inverse-fg grid place-items-center disabled:opacity-30 cursor-pointer" disabled={busy || !q.trim()} aria-label={L('Gửi', 'Send')}><Icon name="arrow-up" className="text-xs" /></button>
        </div>
        <p className="text-[11px] text-muted mt-2">{t('aiDisclaimer')}</p>
      </form>
    </aside>
  )
}
