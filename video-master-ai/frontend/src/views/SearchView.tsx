import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { COLORS, colorName, detColors, FILTER_GROUPS, labelOf } from '../lib/domain'
import { fmt, hms, isoToLocalInput, localInputToIso } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, qc, refreshCase, useCases, useSnapshots, useVideos, useWatch } from '../lib/queries'
import { gotoVideo, openModal, toast, useUI, type ReportTab } from '../lib/store'
import { emptyFilters, type Filters, type ResultItem, type Zone } from '../lib/types'
import { Dots, Empty, Icon, Swatch } from '../components/ui'
import { isLive } from '../components/Sidebar'

const REP_TABS: ReportTab[] = ['person', 'gait', 'face', 'zone', 'vehicle', 'plate']

export function useScope() {
  const { data: videos = EMPTY } = useVideos()
  const checked = useUI(s => s.checked)
  return videos.filter(v => isLive(v) && checked[v.id])
}

export function describeFilters(f: Filters, t: ReturnType<typeof useT>['t'], lang: 'vi' | 'en') {
  const out: string[] = []
  FILTER_GROUPS.forEach(g => g.opts.forEach(([v, lb]) => { if (f[g.k].includes(v)) out.push(t(lb as any)) }))
  f.color.forEach(c => out.push(colorName(c, lang)))
  return out
}

export default function SearchView() {
  const { t, L, lang } = useT()
  const ui = useUI()
  const { reportTab, searchMode, filters, sort, plateQuery, faceQuery, nlParsed, caseId, filterOpen, set } = ui
  const scope = useScope()
  const scopeIds = scope.filter(v => v.state === 'ANALYZED').map(v => v.id).sort()
  const { data: cases = EMPTY } = useCases()
  const activeCase = cases.find(c => c.id === caseId)
  const { data: snaps } = useSnapshots(caseId)
  const { data: watch } = useWatch()
  const [nl, setNl] = useState('')
  const [plateInput, setPlateInput] = useState(plateQuery)

  const mode = reportTab === 'zone' ? 'zone' : reportTab
  const search = useQuery({
    queryKey: ['search', mode, scopeIds, filters, sort, plateQuery, faceQuery?.id],
    queryFn: () => api<{ items: ResultItem[]; count: number }>('/api/search', {
      body: { mode, video_ids: scopeIds, filters, sort, plate_query: mode === 'plate' ? plateQuery : '', face_query_id: mode === 'face' ? faceQuery?.id : null },
    }),
    enabled: mode !== 'zone',
  })
  const zones = useQuery({
    queryKey: ['zones', scopeIds, filters],
    queryFn: () => api<{ zones: Zone[]; count: number }>('/api/zones/query', { body: { video_ids: scope.map(v => v.id), filters } }),
    enabled: mode === 'zone',
  })
  const items = search.data?.items || []
  const count = mode === 'zone' ? zones.data?.count || 0 : items.length

  async function submitNl(e: React.FormEvent) {
    e.preventDefault()
    if (!nl.trim()) return
    const p = await api<{ filters: Filters; vehicle: boolean; empty: boolean; understood_vi: string[]; understood_en: string[] }>('/api/search/parse', { body: { q: nl } })
    if (p.empty) return set({ nlParsed: { text: t('nlNone'), none: true } })
    const tab: ReportTab = p.vehicle ? 'vehicle' : ['vehicle', 'plate', 'zone'].includes(reportTab) ? 'person' : reportTab
    set({ nlUndo: { filters, tab: reportTab }, filters: p.filters, reportTab: tab, nlParsed: { text: (lang === 'vi' ? p.understood_vi : p.understood_en).join(', ') } })
  }
  async function submitPlate(e: React.FormEvent) {
    e.preventDefault()
    const q = plateInput.trim()
    if (!q) return
    set({ plateQuery: q, reportTab: 'plate' })
    api('/api/search', { body: { mode: 'plate', video_ids: scopeIds, plate_query: q, log: true } }).catch(() => {})
  }
  const toggle = (g: keyof Filters, v: string) => set(s => {
    const cur = s.filters[g] as string[]
    return { filters: { ...s.filters, [g]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] } }
  })

  const chips: [keyof Filters, string, string, string?][] = []
  FILTER_GROUPS.forEach(g => g.opts.forEach(([v, lb]) => { if (filters[g.k].includes(v)) chips.push([g.k, v, t(lb as any)]) }))
  filters.color.forEach(c => chips.push(['color', c, colorName(c, lang), COLORS[c]?.hex]))
  if (filters.from) chips.push(['from', '', `${t('from')} ${isoToLocalInput(filters.from).replace('T', ' ')}`])
  if (filters.to) chips.push(['to', '', `${t('to')} ${isoToLocalInput(filters.to).replace('T', ' ')}`])
  const filterCount = chips.length
  const queryBanner = mode === 'face' && faceQuery ? L(`Kết quả cho ${faceQuery.count} ảnh khuôn mặt (${faceQuery.same ? 'một đối tượng' : 'nhiều đối tượng'}), xếp theo độ tương đồng`, `Results for ${faceQuery.count} face photos (${faceQuery.same ? 'one person' : 'several people'}), by similarity`)
    : mode === 'plate' && plateQuery ? L(`Biển số khớp "${plateQuery}"`, `Plates matching "${plateQuery}"`) : ''
  const queryDesc = [queryBanner, ...describeFilters(filters, t, lang)].filter(Boolean).join(', ')

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-4 sm:px-6 pt-6">
          <div className="mb-4"><h1 className="text-lg font-bold">{t('report')}</h1>
            <p className="text-sm text-muted mt-0.5">{L('Tìm người, phương tiện, biển số trong các video đã tick ở cột trái, bằng mô tả, ảnh khuôn mặt hoặc biển số. Bấm một kết quả để xem chi tiết và gắn thẻ.', 'Find people, vehicles and plates in the videos ticked on the left, by description, face photo or plate. Click a result to see details and tag it.')}</p></div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="inline-flex p-1 rounded-lg bg-subtle ring-1 ring-line" role="group" aria-label={L('Cách tìm', 'Search by')}>
              {([['text', 'wand', L('Mô tả', 'Description')], ['face', 'scan-face', L('Ảnh khuôn mặt', 'Face photo')], ['plate', 'plate', L('Biển số', 'Plate')]] as const).map(([k, icon, lb]) => (
                <button key={k} className="chip border-0 h-8" aria-pressed={searchMode === k} disabled={k === 'face' && !can('search.face')}
                  onClick={() => set({ searchMode: k, ...(k === 'face' ? { reportTab: 'face' as const } : k === 'plate' ? { reportTab: 'plate' as const } : {}) })}><Icon name={icon} /><span>{lb}</span></button>
              ))}
            </div>
            <span className="flex-1" />
            <button className="btn btn-quiet" onClick={() => openModal('watchlist')}><Icon name="eye" /><span>{t('watchlist')}</span><span className="tag bg-accent/10 text-accent">{(watch?.faces.length || 0) + (watch?.plates.length || 0)}</span></button>
          </div>
          {searchMode === 'face' && <FacePanel />}
          {searchMode === 'plate' && (
            <form onSubmit={submitPlate} className="flex items-center gap-2 h-11 pl-3 pr-1 rounded-lg border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition">
              <Icon name="plate" className="text-accent text-sm" />
              <input value={plateInput} onChange={e => setPlateInput(e.target.value)} autoFocus className="flex-1 min-w-0 bg-transparent outline-none text-sm font-mono uppercase placeholder:font-sans placeholder:normal-case placeholder:text-muted"
                placeholder={L('Biển số đã đọc (OCR), ví dụ 29A-123.45, 30G hoặc 51F-888.*', 'Plate read by OCR, e.g. 29A-123.45, 30G or 51F-888.*')} aria-label={L('Tìm biển số', 'Search plate')} />
              <button className="btn btn-primary h-9" type="submit">{t('find')}</button>
            </form>
          )}
          {searchMode === 'text' && (
            <form id="nlForm" onSubmit={submitNl} className="flex items-center gap-2 h-11 pl-3 pr-1 rounded-lg border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 transition">
              <Icon name="wand" className="text-accent text-sm" />
              <input value={nl} onChange={e => setNl(e.target.value)} className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-muted" placeholder={t('nlPh')} aria-label={L('Tìm bằng mô tả', 'Search by description')} />
              <button className="btn btn-primary h-9" type="submit">{t('find')}</button>
            </form>
          )}
          {nlParsed && searchMode === 'text' && (
            <p className="text-xs text-muted mt-2">
              {nlParsed.none ? <><Icon name="info" className="mr-1" />{nlParsed.text}</> : <>
                <Icon name="wand" className="text-accent mr-1" />{t('nlUnderstood')}: <span className="text-fg">{nlParsed.text}</span>
                <button className="underline underline-offset-2 ml-2 hover:text-fg cursor-pointer" onClick={() => { const u = ui.nlUndo; if (u) set({ filters: u.filters, reportTab: u.tab, nlUndo: null, nlParsed: null }) }}>{t('undo')}</button></>}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {scope.length ? <>
              <span className="text-xs text-muted mr-1">{L(`Đang tìm trong ${scope.length} video đã tick ở cột trái`, `Searching ${scope.length} videos ticked on the left`)}:</span>
              {scope.map(v => (
                <button key={v.id} className="chip h-7 text-xs" aria-pressed="true" data-tip={`${L('Bấm để bỏ video này khỏi phạm vi tìm', 'Click to drop this video from the search')}: ${v.name}`}
                  onClick={() => set(s => ({ checked: { ...s.checked, [v.id]: false } }))}>{v.parent_id && <Icon name="scissors" className="text-[10px]" />}<span className="font-mono">{v.evidence_id || v.name}</span><Icon name="x" className="text-[10px]" /></button>
              ))}
            </> : <>
              <span className="inline-flex items-center gap-2 text-xs text-warn"><Icon name="info" className="text-sm" />{L('Chưa tick video nào ở cột trái.', 'No video ticked on the left.')}</span>
              {activeCase && <button className="text-xs text-accent hover:underline underline-offset-2 cursor-pointer" onClick={() => {
                const ids = qc.getQueryData<any[]>(['videos'])?.filter(v => v.case_id === caseId && !v.parent_id && isLive(v)).map(v => v.id) || []
                set(s => ({ checked: { ...s.checked, ...Object.fromEntries(ids.map(id => [id, true])) } }))
              }}>{L(`Chọn mọi video gốc của ${activeCase.code}`, `Select all originals in ${activeCase.code}`)}</button>}
            </>}
          </div>
        </div>
        <div className="flex items-center gap-4 px-4 sm:px-6 mt-4">
          <div className="tabs flex-1 min-w-0 no-scrollbar" role="tablist">
            {REP_TABS.map(k => <button key={k} role="tab" aria-selected={reportTab === k} onClick={() => set({ reportTab: k })}>{t(k)}</button>)}
          </div>
          <select className="h-9 rounded-md bg-surface border border-line text-sm px-2 focus:outline-none focus:border-accent" aria-label={L('Sắp xếp', 'Sort')} value={sort} onChange={e => set({ sort: e.target.value as any })}>
            <option value="time">{t('sortTime')}</option><option value="conf">{t('sortConf')}</option>
          </select>
          <button className="btn btn-quiet xl:hidden" data-tip={t('tipFilters')} onClick={() => set({ filterOpen: true })}><Icon name="sliders" /><span className="tabular">{filterCount || ''}</span></button>
        </div>
        <div className="flex flex-wrap gap-2 px-4 sm:px-6 pt-4 empty:hidden">
          {queryBanner && (
            <span className="inline-flex items-center gap-2 h-7 px-3 rounded-full bg-accent/10 text-accent text-xs font-medium"><Icon name={mode === 'face' ? 'scan-face' : 'plate'} className="text-sm" />{queryBanner}
              <button className="cursor-pointer" aria-label={L('Xóa', 'Clear')} onClick={() => mode === 'face' ? set({ faceQuery: null }) : (set({ plateQuery: '' }), setPlateInput(''))}><Icon name="x" className="text-xs" /></button></span>
          )}
          {chips.map(([g, v, lb, hex]) => (
            <button key={g + v} className="chip h-7 text-xs" aria-label={`${L('Bỏ', 'Remove')} ${lb}`} onClick={() => set(s => ({ filters: g === 'from' || g === 'to' ? { ...s.filters, [g]: '' } : { ...s.filters, [g]: (s.filters[g] as string[]).filter(x => x !== v) } }))}>
              {hex && <span className="w-2.5 h-2.5 rounded-full" style={{ background: hex }} />}{lb}<Icon name="x" className="text-[10px]" /></button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {mode === 'zone' ? <ZonesTab zones={zones.data?.zones || []} loading={zones.isLoading} /> :
            search.isLoading ? <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="aspect-[3/4] rounded-md shimmer" />)}</div> :
            items.length ? (
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">{items.map(d => <ResultCard key={d.id} d={d} mode={mode} />)}</div>
            ) : (
              <Empty title={t('noResults')} hint={t('noResultsHint')}>
                <button className="btn btn-quiet mt-4" onClick={() => set({ filters: emptyFilters(), nlParsed: null })}>{t('resetFilters')}</button>
              </Empty>
            )}
        </div>
        <footer className="h-10 shrink-0 px-4 sm:px-6 flex items-center gap-4 text-xs text-muted border-t border-line">
          <span className="text-fg font-medium">{count} {t('results')}</span><span className="truncate">{t('inVideos', { n: scope.length })}</span>
          <span className="ml-auto">{snaps?.attachments ? t('attach', { n: snaps.attachments }) : ''}</span>
        </footer>
      </div>

      <aside id="filterPanel" aria-label={t('filters')}
        className={`fixed inset-y-0 right-0 z-50 w-[min(300px,88vw)] ${filterOpen ? 'translate-x-0' : 'translate-x-full'} xl:static xl:translate-x-0 xl:z-auto xl:w-[280px] shrink-0 flex flex-col bg-surface border-l border-line transition-transform duration-300`}>
        <div className="flex items-center justify-between h-12 px-4 border-b border-line shrink-0"><h2 className="text-sm font-semibold">{t('filters')}</h2>
          <button className="text-xs text-muted hover:text-fg cursor-pointer" onClick={() => set({ filters: emptyFilters(), nlParsed: null })}>{t('reset')}</button></div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <fieldset><legend className="label mb-2">{t('time')}</legend><div className="space-y-2">
            <input type="datetime-local" step={1} className="inp" aria-label={t('from')} value={isoToLocalInput(filters.from)} onChange={e => set(s => ({ filters: { ...s.filters, from: localInputToIso(e.target.value) } }))} />
            <input type="datetime-local" step={1} className="inp" aria-label={t('to')} value={isoToLocalInput(filters.to)} onChange={e => set(s => ({ filters: { ...s.filters, to: localInputToIso(e.target.value) } }))} />
          </div></fieldset>
          {FILTER_GROUPS.map(g => (
            <fieldset key={g.k}><legend className="label mb-2">{t(g.label as any)}</legend><div className="flex flex-wrap gap-2">
              {g.opts.map(([v, lb]) => <button key={v} type="button" className="chip" aria-pressed={filters[g.k].includes(v)} onClick={() => toggle(g.k, v)}>{t(lb as any)}</button>)}
            </div></fieldset>
          ))}
          <fieldset><legend className="label mb-2">{t('fColor')}</legend><div className="grid grid-cols-7 gap-2">
            {Object.keys(COLORS).map(k => <Swatch key={k} color={k} pressed={filters.color.includes(k)} onClick={() => toggle('color', k)} />)}
          </div></fieldset>
        </div>
        <div className="p-4 border-t border-line grid gap-2 shrink-0">
          {can('report.pdf', activeCase) && <button className="btn btn-primary" disabled={!count || mode === 'zone'} onClick={() => openModal('pdf', { ids: items.map(i => i.id), query: queryDesc, caseId })}><Icon name="file-down" />{t('exportPdf')}</button>}
          {can('package', activeCase) && <button className="btn btn-quiet" onClick={() => openModal('package', { caseId })}><Icon name="package" />{L('Xuất gói chứng cứ .zip', 'Evidence package .zip')}</button>}
          <button className="btn btn-quiet xl:hidden" onClick={() => set({ filterOpen: false })}>{t('showResults')} ({count})</button>
        </div>
      </aside>
      {filterOpen && <div className="fixed inset-0 z-40 bg-black/40 xl:hidden" onClick={() => set({ filterOpen: false })} />}
    </div>
  )
}

function ResultCard({ d, mode }: { d: ResultItem; mode: string }) {
  const { L, lang } = useT()
  const portrait = d.kind === 'person'
  const img = mode === 'face' ? d.face_url || d.crop_url : d.crop_url
  return (
    <button className="group text-left focus-visible:outline-none cursor-pointer" aria-label={labelOf(d, lang)} onClick={() => openModal('detail', { item: d })}>
      <span className={`block relative ${portrait && mode !== 'face' ? 'aspect-[3/4]' : mode === 'face' ? 'aspect-square' : 'aspect-[4/3]'} rounded-md overflow-hidden bg-subtle ring-1 ring-line group-hover:ring-fg group-focus-visible:ring-2 group-focus-visible:ring-accent transition`}>
        {img ? <img loading="lazy" src={media(img)} className="w-full h-full object-cover bg-black" alt="" /> : <span className="absolute inset-0 grid place-items-center text-muted"><Icon name="image" /></span>}
        {mode === 'plate' && d.plate && <span className="absolute inset-x-0 bottom-3 text-center"><span className="plate">{d.plate}</span></span>}
        {d.tag_color && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full ring-2 ring-white" style={{ background: COLORS[d.tag_color]?.hex }} />}
        {d.watch_item_id && <span className="absolute top-2 left-2 tag bg-danger text-white"><Icon name="shield-alert" className="text-[10px]" />{L('Theo dõi', 'Watchlist')}</span>}
        {d.query_index != null && <span className="absolute bottom-2 left-2 tag bg-black/70 text-white">{L('Ảnh', 'Photo')} {d.query_index + 1}</span>}
        {d.is_clip && <span className="absolute bottom-2 right-2 tag bg-black/70 text-white"><Icon name="scissors" className="text-[9px]" /></span>}
      </span>
      <span className="flex items-center justify-between gap-2 mt-2"><span className="text-[13px] font-medium truncate">{labelOf(d, lang)}</span><Dots colors={detColors(d)} /></span>
      <span className="flex justify-between gap-2 text-[11px] text-muted mt-0.5">
        <span className="font-mono tabular truncate">{d.evidence_id} · {hms(d.abs_in)}</span>
        <span className="tabular">{d.similarity != null ? <b className={d.similarity >= 85 ? 'text-ok' : 'text-fg'}>{d.similarity}%</b> : `${d.confidence}%`}</span>
      </span>
    </button>
  )
}

function ZonesTab({ zones, loading }: { zones: Zone[]; loading: boolean }) {
  const { L } = useT()
  const { caseId } = useUI()
  const { data: cases = EMPTY } = useCases()
  const c = cases.find(x => x.id === caseId)
  const head = (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <p className="text-sm text-muted flex-1 min-w-[220px]">{L('Khoanh một vùng trên video, AI liệt kê mọi người và phương tiện đi vào vùng đó cùng thời điểm vào, ra.', 'Outline an area on a video; AI lists every person and vehicle that enters it, with entry and exit times.')}</p>
      {can('zone', c) && <button className="btn btn-primary" onClick={() => openModal('zone')}><Icon name="pentagon" />{L('Thêm vùng', 'Add zone')}</button>}
    </div>
  )
  if (loading) return <>{head}<div className="h-40 shimmer rounded-lg" /></>
  if (!zones.length) return <>{head}<div className="panel p-8 text-center">
    <span className="w-11 h-11 rounded-lg bg-accent/10 text-accent grid place-items-center text-xl mx-auto"><Icon name="pentagon" /></span>
    <p className="font-semibold mt-3">{L('Chưa có vùng nào trong các video đã tick', 'No zones in the ticked videos')}</p>
    <p className="text-sm text-muted mt-1">{L('Bấm Thêm vùng, chọn video, vẽ vùng rồi phân tích.', 'Press Add zone, pick a video, draw the area, then analyse.')}</p></div></>
  const del = async (z: Zone) => {
    try { await api(`/api/zones/${z.id}`, { method: 'DELETE' }); refreshCase(); toast(L('Đã xóa vùng', 'Zone deleted'), 'success') }
    catch (e) { if (e instanceof ApiError) toast(e.vi, 'error') }
  }
  return (
    <div className="space-y-4">{head}
      {zones.map(z => (
        <section key={z.id} className="panel overflow-hidden"><div className="grid md:grid-cols-[300px_minmax(0,1fr)]">
          <div className="relative aspect-video bg-black">
            <img src={media(`/api/media/videos/${z.video_id}/frame`, { t: Math.round(z.thumb_t * 10) / 10 })} className="absolute inset-0 w-full h-full object-cover" alt="" />
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={z.polygon.map(p => p.join(',')).join(' ')} fill="rgba(94,158,255,.22)" stroke="#8CB4FF" strokeWidth={2} vectorEffect="non-scaling-stroke" /></svg>
          </div>
          <div className="p-4 min-w-0">
            <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><h3 className="font-bold truncate">{z.name}</h3>
              <p className="text-xs text-muted mt-0.5"><span className="font-mono">{z.evidence_id}</span> · {z.video_name} · {[z.people && L('Người', 'People'), z.vehicles && L('Phương tiện', 'Vehicles')].filter(Boolean).join(', ')}</p></div>
              <span className={`tag ${z.hits.length ? 'bg-accent/10 text-accent' : 'tag-orig'} h-6 px-2 text-xs`}>{z.pending ? L('Chờ phân tích video', 'Waiting for analysis') : `${z.hits.length} ${L('đối tượng', 'subjects')}`}</span>
              {can('zone', c) && <button className="icon-btn-sm" aria-label={L('Xóa vùng', 'Delete zone')} data-tip={L('Xóa vùng', 'Delete zone')} onClick={() => del(z)}><Icon name="trash" className="text-sm" /></button>}</div>
            {z.hits.length ? (
              <ul className="mt-3 grid sm:grid-cols-2 2xl:grid-cols-3 gap-2">{z.hits.map(h => (
                <li key={h.id}><button className="w-full flex items-center gap-3 p-2 rounded-md ring-1 ring-line hover:bg-subtle text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer" onClick={() => gotoVideo(h.video_id, h.enter_t || h.t_in, h.id)}>
                  <img src={media(h.kind === 'person' ? h.face_url || h.crop_url : h.crop_url)} className="w-10 h-10 rounded-sm object-cover bg-black shrink-0" alt="" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium truncate">{h.kind === 'person' ? `${L('Người', 'Person')} ${h.track_id}` : h.plate || h.track_id}</span>
                    <span className="block text-xs text-muted"><span className="font-mono">{fmt(h.enter_t || 0)}</span> → <span className="font-mono">{fmt(h.exit_t || 0)}</span> · {Math.max(1, Math.round((h.exit_t || 0) - (h.enter_t || 0)))} {L('giây trong vùng', 's inside')}</span></span>
                  {h.watch_item_id && <Icon name="shield-alert" className="text-danger" />}</button></li>
              ))}</ul>
            ) : !z.pending ? <p className="text-sm text-muted mt-3">{L('Không có đối tượng nào khớp bộ lọc đi vào vùng này.', 'No subject matching the filters entered this zone.')}</p> : null}
          </div></div></section>
      ))}
    </div>
  )
}

function FacePanel() {
  const { L, lang } = useT()
  const { set } = useUI()
  const { data: watch } = useWatch()
  const [slots, setSlots] = useState<({ file?: File; sample?: string; src: string } | null)[]>([null, null, null])
  const [same, setSame] = useState(true)
  const [busy, setBusy] = useState(false)
  const lbl = same ? [L('Chính diện', 'Front'), L('Nghiêng trái', 'Left'), L('Nghiêng phải', 'Right')] : [L('Đối tượng 1', 'Subject 1'), L('Đối tượng 2', 'Subject 2'), L('Đối tượng 3', 'Subject 3')]
  const n = slots.filter(Boolean).length
  const sample = watch?.faces.find(f => f.images.length)
  const run = async () => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('same', String(same))
      fd.append('sample_ids', slots.filter(s => s?.sample).map(s => s!.sample).join(','))
      slots.forEach(s => s?.file && fd.append('files', s.file))
      const r = await api<{ face_query_id: string; count: number }>('/api/search/face', { body: fd })
      set({ faceQuery: { id: r.face_query_id, count: r.count, same }, reportTab: 'face' })
    } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="panel p-4"><div className="flex flex-wrap items-start gap-4">
      <div className="flex gap-3">{slots.map((f, i) => (
        <div key={i} className="w-24">
          <label className={`relative block w-24 h-24 rounded-lg overflow-hidden ${f ? 'ring-1 ring-line' : 'border-2 border-dashed border-line2'} bg-bg cursor-pointer hover:border-accent group`} data-tip={L('Chọn ảnh khuôn mặt', 'Choose a face photo')}>
            {f ? <img src={f.src} className="w-full h-full object-cover" alt="" /> : <span className="absolute inset-0 grid place-items-center text-muted group-hover:text-accent"><Icon name="image-plus" className="text-xl" /></span>}
            <input type="file" accept="image/*" className="sr-only" aria-label={lbl[i]} onChange={e => { const file = e.target.files?.[0]; if (file) setSlots(s => s.map((x, j) => (j === i ? { file, src: URL.createObjectURL(file) } : x))) }} />
          </label>
          <div className="flex items-center justify-between mt-1"><span className="text-2xs text-muted truncate">{lbl[i]}</span>
            {f && <button className="text-muted hover:text-danger cursor-pointer" aria-label={L('Bỏ ảnh', 'Remove photo')} onClick={() => setSlots(s => s.map((x, j) => (j === i ? null : x)))}><Icon name="x" className="text-xs" /></button>}</div>
        </div>
      ))}</div>
      <div className="flex-1 min-w-[220px] space-y-3">
        <fieldset><legend className="label">{L('Các ảnh này là', 'These photos show')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="fsame" className="accent-[rgb(var(--accent))]" checked={same} onChange={() => setSame(true)} />{L('Một đối tượng, nhiều góc mặt', 'One person, several angles')}</label>
            <label className="flex items-center gap-2"><input type="radio" name="fsame" className="accent-[rgb(var(--accent))]" checked={!same} onChange={() => setSame(false)} />{L('Nhiều đối tượng khác nhau', 'Different people')}</label>
          </div></fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={!n || busy} onClick={run}>{busy ? <Icon name="loader" /> : <Icon name="scan-face" />}{L('Tìm khuôn mặt', 'Search faces')}{n ? ` (${n})` : ''}</button>
          {sample && <button className="btn btn-ghost text-accent" onClick={() => { setSlots([0, 1, 2].map(i => sample.images[i] ? { sample: sample.images[i].split('/').pop()!, src: media(sample.images[i]) } : null)); setSame(true) }}>{L('Dùng ảnh mẫu', 'Use sample photos')}</button>}
        </div>
        <p className="text-xs text-muted">{L('Tối đa 3 ảnh. Ảnh rõ mặt, chính diện cho kết quả tốt nhất; khuôn mặt đeo khẩu trang không được đối chiếu.', 'Up to 3 photos. Clear, frontal faces work best; masked faces are not compared.')}</p>
      </div>
    </div></div>
  )
}
