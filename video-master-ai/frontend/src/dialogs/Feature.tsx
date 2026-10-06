import { useRef, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { attrOf, colorName, labelOf, TAG_COLORS } from '../lib/domain'
import { clamp, dmy, hms } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, qc, refreshCase, useCases, useTags, useVideos, useWatch } from '../lib/queries'
import { closeModal, gotoVideo, openModal, toast, useUI } from '../lib/store'
import { emptyFilters, type ResultItem } from '../lib/types'
import { FieldError, Icon, Modal, Swatch } from '../components/ui'
import { isLive } from '../components/Sidebar'

/* ------------------------------------------------------------------ UR-WATCH-01 */
export function WatchlistDialog({ tab: initial = 'faces', back }: { tab?: 'faces' | 'plates'; back?: string }) {
  const { L, lang } = useT()
  const { data } = useWatch()
  const [tab, setTab] = useState(initial)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [plate, setPlate] = useState('')
  const [files, setFiles] = useState<(File | null)[]>([null, null, null])
  const [errs, setErrs] = useState<Record<string, string>>({})
  const manage = can('watch.manage')
  const F = data?.faces || []
  const P = data?.plates || []
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ['watch'] }); refreshCase(); toast(msg, 'success') }
  const addPlate = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = plate.trim().toUpperCase()
    if (!/^[0-9A-Z]{2,4}-?[0-9A-Z.*?]{2,8}$/.test(p)) return setErrs({ plate: L('Dạng biển số: 30K-456.78, có thể dùng * hoặc ?', 'Format: 30K-456.78, * or ? allowed') })
    try { await api('/api/watch/plates', { body: { plate: p, note } }); setPlate(''); setNote(''); setErrs({}); done(L('Đã thêm vào danh sách theo dõi', 'Added to the watchlist')) }
    catch (er) { if (er instanceof ApiError) setErrs({ plate: er.msg(lang) }) }
  }
  const addFace = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = L('Nhập tên đối tượng.', 'Enter a name.')
    if (!files.some(Boolean)) errors.files = L('Thêm ít nhất 1 ảnh.', 'Add at least one photo.')
    setErrs(errors)
    if (Object.keys(errors).length) return
    const fd = new FormData()
    fd.append('name', name)
    fd.append('note', note)
    files.forEach(f => f && fd.append('files', f))
    try { await api('/api/watch/faces', { body: fd }); setName(''); setNote(''); setFiles([null, null, null]); done(L('Đã thêm vào danh sách theo dõi', 'Added to the watchlist')) }
    catch (er) { if (er instanceof ApiError) setErrs({ _: er.msg(lang) }) }
  }
  const del = async (id: string) => { await api(`/api/watch/${id}`, { method: 'DELETE' }); done(L('Đã xóa khỏi danh sách theo dõi', 'Removed from the watchlist')) }
  return (
    <Modal onClose={() => (back ? openModal(back) : closeModal())} size="sm:max-w-2xl" label={L('Danh sách theo dõi', 'Watchlist')}>
      <div className="flex flex-col max-h-[90vh]">
        <header className="px-6 pt-6"><div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold">{L('Danh sách theo dõi', 'Watchlist')}</h2>
          <p className="text-sm text-muted mt-1">{L('Mọi video mới tải lên được đối chiếu với danh sách này ngay trong lúc phân tích. Khi khớp, hệ thống cảnh báo sớm, không đợi phân tích xong.', 'Every new upload is checked against this list while it is analysed. A match raises an early alert without waiting for analysis to finish.')}</p></div>
          <button className="icon-btn -mr-2 -mt-2" aria-label={L('Đóng', 'Close')} onClick={() => (back ? openModal(back) : closeModal())}><Icon name="x" /></button></div>
          <div className="tabs mt-4" role="tablist">{([['faces', L('Khuôn mặt', 'Faces'), F.length], ['plates', L('Biển số', 'Plates'), P.length]] as const).map(([k, t, n]) =>
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErrs({}) }}>{t}<span className="text-xs text-muted">{n}</span></button>)}</div></header>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
          {tab === 'faces' ? <>
            <ul className="space-y-2">{F.map(w => (
              <li key={w.id} className="flex items-center gap-3 p-3 rounded-lg ring-1 ring-line">
                <span className="flex -space-x-2 shrink-0">{w.images.map(src => <img key={src} src={media(src)} className="w-10 h-10 rounded-full object-cover ring-2 ring-surface bg-black" alt="" />)}</span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold truncate">{w.name}</span><span className="block text-xs text-muted truncate">{w.note} · {w.images.length} {L('ảnh', 'photos')} · {w.by}</span></span>
                {manage && <button className="icon-btn-sm" aria-label={L('Xóa khỏi danh sách', 'Remove')} onClick={() => del(w.id)}><Icon name="trash" className="text-sm" /></button>}
              </li>))}
              {!F.length && <li className="text-sm text-muted">{L('Chưa có khuôn mặt nào.', 'No faces yet.')}</li>}</ul>
            {manage && <form noValidate onSubmit={addFace} className="mt-5 p-4 rounded-lg bg-subtle/60 ring-1 ring-line space-y-3"><h3 className="text-sm font-bold">{L('Thêm khuôn mặt', 'Add a face')}</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="label">{L('Tên / mô tả đối tượng', 'Subject name')}</span><input className="inp mt-1" value={name} aria-invalid={!!errs.name} onChange={e => setName(e.target.value)} /><FieldError msg={errs.name} /></label>
                <label className="block"><span className="label">{L('Ghi chú', 'Note')}</span><input className="inp mt-1" value={note} onChange={e => setNote(e.target.value)} /></label></div>
              <div><span className="label">{L('Ảnh khuôn mặt (1 đến 3 góc)', 'Face photos (1 to 3 angles)')}</span><div className="flex gap-3 mt-1">{files.map((f, i) => (
                <label key={i} className="relative w-20 h-20 rounded-lg border-2 border-dashed border-line2 bg-surface grid place-items-center text-muted hover:text-accent hover:border-accent cursor-pointer overflow-hidden">
                  {f ? <img src={URL.createObjectURL(f)} className="absolute inset-0 w-full h-full object-cover" alt="" /> : <Icon name="image-plus" className="text-lg" />}
                  <input type="file" accept="image/*" className="sr-only" aria-label={`${L('Ảnh', 'Photo')} ${i + 1}`} onChange={e => { const file = e.target.files?.[0] || null; setFiles(fs => fs.map((x, j) => (j === i ? file : x))) }} /></label>))}</div>
                <FieldError msg={errs.files} /></div>
              <FieldError msg={errs._} />
              <div className="flex justify-end"><button className="btn btn-primary"><Icon name="eye" />{L('Thêm vào danh sách', 'Add to watchlist')}</button></div></form>}
          </> : <>
            <ul className="space-y-2">{P.map(w => (
              <li key={w.id} className="flex items-center gap-3 p-3 rounded-lg ring-1 ring-line"><span className="plate !text-xs shrink-0">{w.plate}</span>
                <span className="min-w-0 flex-1 text-xs text-muted truncate">{w.note} · {w.by}</span>
                {manage && <button className="icon-btn-sm" aria-label={L('Xóa khỏi danh sách', 'Remove')} onClick={() => del(w.id)}><Icon name="trash" className="text-sm" /></button>}</li>))}
              {!P.length && <li className="text-sm text-muted">{L('Chưa có biển số nào.', 'No plates yet.')}</li>}</ul>
            {manage && <form noValidate onSubmit={addPlate} className="mt-5 p-4 rounded-lg bg-subtle/60 ring-1 ring-line space-y-3"><h3 className="text-sm font-bold">{L('Thêm biển số', 'Add a plate')}</h3>
              <div className="grid sm:grid-cols-[200px_1fr] gap-3">
                <label className="block"><span className="label">{L('Biển số', 'Plate')}</span><input className="inp mt-1 font-mono uppercase" placeholder="30K-456.78" value={plate} aria-invalid={!!errs.plate} onChange={e => setPlate(e.target.value)} /><FieldError msg={errs.plate} /></label>
                <label className="block"><span className="label">{L('Ghi chú', 'Note')}</span><input className="inp mt-1" value={note} onChange={e => setNote(e.target.value)} /></label></div>
              <p className="text-xs text-muted">{L('Dùng * cho phần chưa đọc được, ví dụ 51F-888.* ; dấu ? thay một ký tự.', 'Use * for unread parts, e.g. 51F-888.* ; ? stands for one character.')}</p>
              <div className="flex justify-end"><button className="btn btn-primary"><Icon name="eye" />{L('Thêm vào danh sách', 'Add to watchlist')}</button></div></form>}
          </>}
          {!manage && <p className="text-xs text-muted mt-4">{L('Bạn chỉ có quyền xem danh sách.', 'You can only view this list.')}</p>}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-ZONE-02 */
export function ZoneDialog() {
  const { L, lang } = useT()
  const { caseId, videoId } = useUI()
  const { data: videos = EMPTY } = useVideos()
  const vids = videos.filter(v => v.case_id === caseId && isLive(v) && v.has_file)
  const [vid, setVid] = useState((vids.find(v => v.id === videoId) || vids[0])?.id || '')
  const v = vids.find(x => x.id === vid)
  const [pts, setPts] = useState<number[][]>([])
  const [closed, setClosed] = useState(false)
  const [name, setName] = useState(L('Vùng mới', 'New zone'))
  const [people, setPeople] = useState(true)
  const [vehicles, setVehicles] = useState(true)
  const [busy, setBusy] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  if (!v) return <Modal onClose={closeModal}><div className="p-6"><p>{L('Vụ án chưa có video để vẽ vùng.', 'This case has no video to draw on.')}</p><button className="btn btn-quiet mt-4" onClick={closeModal}>{L('Đóng', 'Close')}</button></div></Modal>
  const click = (e: React.MouseEvent) => {
    if (closed) return
    const r = stage.current!.getBoundingClientRect()
    const p = [clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), clamp(((e.clientY - r.top) / r.height) * 100, 0, 100)]
    const f = pts[0]
    if (f && pts.length >= 3 && Math.hypot(((p[0] - f[0]) * r.width) / 100, ((p[1] - f[1]) * r.height) / 100) < 14) setClosed(true)
    else setPts([...pts, p])
  }
  const hint = !pts.length ? L('Nhấn lên khung hình để đặt đỉnh đầu tiên của vùng.', 'Click the frame to place the first corner.')
    : pts.length < 3 ? L(`Đặt thêm ${3 - pts.length} điểm nữa (tối thiểu 3 điểm).`, `Place ${3 - pts.length} more points (3 minimum).`)
    : !closed ? L('Nhấn vào điểm đầu tiên (chấm xanh) để khép vùng, hoặc đặt thêm điểm.', 'Click the first point (blue dot) to close the zone, or add more points.')
    : L('Vùng đã khép. Bấm Phân tích vùng.', 'Zone closed. Press Analyse zone.')
  const why = !closed ? L('Vẽ và khép vùng để phân tích.', 'Draw and close the zone to analyse.') : !people && !vehicles ? L('Chọn ít nhất Người hoặc Phương tiện.', 'Pick People or Vehicles.') : !name.trim() ? L('Đặt tên cho vùng.', 'Name the zone.') : ''
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (why) return
    setBusy(true)
    try {
      const r = await api<{ pending: boolean; count: number }>('/api/zones', { body: { video_id: v.id, name, polygon: pts, people, vehicles } })
      useUI.setState(s => ({ checked: { ...s.checked, [v.id]: true }, reportTab: 'zone', tab: 'report', modal: null }))
      refreshCase()
      toast(r.pending ? L('Đã lưu vùng. Kết quả hiện khi video phân tích xong.', 'Zone saved. Results appear when analysis finishes.') : L(`Tìm thấy ${r.count} đối tượng đi vào ${name}`, `${r.count} subjects entered ${name}`), 'success')
    } catch (er) { if (er instanceof ApiError) toast(er.msg(lang), 'error') } finally { setBusy(false) }
  }
  const poly = pts.map(p => p.join(',')).join(' ')
  return (
    <Modal onClose={closeModal} size="sm:max-w-3xl" label={L('Thêm vùng nhận diện', 'Add a detection zone')}>
      <form noValidate onSubmit={save} className="flex flex-col max-h-[90vh]">
        <header className="px-6 pt-6 pb-4 border-b border-line"><h2 className="text-lg font-bold">{L('Thêm vùng nhận diện', 'Add a detection zone')}</h2>
          <ol className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted">{[L('Chọn video', 'Pick video'), L('Vẽ vùng', 'Draw zone'), L('Phân tích', 'Analyse')].map((x, i) =>
            <li key={i} className="flex items-center gap-1.5">{i > 0 && <Icon name="chevron-right" className="text-xs" />}<span className="w-5 h-5 rounded-full bg-accent/10 text-accent grid place-items-center text-[11px] font-bold">{i + 1}</span>{x}</li>)}</ol></header>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid sm:grid-cols-[1fr_200px] gap-4">
            <label className="block"><span className="label">1. Video</span><select className="inp mt-1.5" value={vid} onChange={e => { setVid(e.target.value); setPts([]); setClosed(false) }}>{vids.map(x => <option key={x.id} value={x.id}>{x.evidence_id} · {x.name}</option>)}</select></label>
            <label className="block"><span className="label">{L('Tên vùng', 'Zone name')}</span><input className="inp mt-1.5" value={name} onChange={e => setName(e.target.value)} /></label>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="label">2. {L('Vẽ vùng trên khung hình', 'Draw on the frame')}</span><span className="flex-1" />
              <button type="button" className="btn btn-ghost h-8 px-2 text-xs" onClick={() => { setClosed(false); setPts(pts.slice(0, -1)) }}><Icon name="undo" />{L('Hoàn tác điểm', 'Undo point')}</button>
              <button type="button" className="btn btn-ghost h-8 px-2 text-xs" onClick={() => { setClosed(false); setPts([]) }}><Icon name="x" />{L('Vẽ lại', 'Clear')}</button></div>
            <div ref={stage} onClick={click} className="relative mt-2 aspect-video rounded-lg overflow-hidden bg-black cursor-crosshair select-none touch-none ring-1 ring-line">
              <img src={media(`/api/media/videos/${v.id}/frame`, { t: Math.round(v.duration * 5) / 10 })} className="absolute inset-0 w-full h-full object-cover pointer-events-none" alt="" />
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {pts.length >= 3 && closed ? <polygon points={poly} fill="rgba(94,158,255,.25)" stroke="#8CB4FF" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  : pts.length > 1 ? <polyline points={poly} fill="none" stroke="#8CB4FF" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" /> : null}
                {pts.map((p, i) => <ellipse key={i} cx={p[0]} cy={p[1]} rx={i ? 0.7 : 1.1} ry={i ? 1.25 : 1.95} fill={i ? '#fff' : '#8CB4FF'} stroke="#0B1220" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              </svg>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted mt-2"><Icon name="lightbulb" className="text-accent" /><span>{hint}</span></p>
          </div>
          <fieldset><legend className="label">3. {L('Tìm trong vùng', 'Look for')}</legend><div className="flex flex-wrap gap-4 mt-1.5">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-[rgb(var(--accent))]" checked={people} onChange={e => setPeople(e.target.checked)} />{L('Người', 'People')}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-[rgb(var(--accent))]" checked={vehicles} onChange={e => setVehicles(e.target.checked)} />{L('Phương tiện', 'Vehicles')}</label></div></fieldset>
        </div>
        <footer className="px-6 py-4 border-t border-line flex flex-wrap items-center gap-3"><p className="text-xs text-muted flex-1 min-w-[180px]">{why || `${v.evidence_id} · ${pts.length} ${L('điểm', 'points')} · ${v.state !== 'ANALYZED' ? L('video đang phân tích, kết quả hiện khi xong', 'video still analysing; results appear when done') : L('sẵn sàng', 'ready')}`}</p>
          <span className="flex gap-2 ml-auto"><button type="button" className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button>
            <button className="btn btn-primary" disabled={!!why || busy}>{busy ? <Icon name="loader" /> : <Icon name="scan" />}{L('Phân tích vùng', 'Analyse zone')}</button></span></footer>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-SRCH-08 */
export function DetailDialog({ item: d }: { item: ResultItem }) {
  const { t, L, lang } = useT()
  const { caseId } = useUI()
  const { data: cases = EMPTY } = useCases()
  const { data: videos = EMPTY } = useVideos()
  const { data: tags = EMPTY } = useTags(caseId)
  const { data: watch } = useWatch()
  const v = videos.find(x => x.id === d.video_id)
  const c = cases.find(x => x.id === v?.case_id)
  const tagged = tags.find(x => x.detection_id === d.id)
  const [color, setColor] = useState<string | null>(tagged?.color || d.tag_color)
  const onWatch = !!d.watch_item_id || !!watch?.plates.some(w => d.plate && w.ref_detection_id === d.id)
  const a = d.attributes
  const rows: [string, React.ReactNode][] = []
  if (d.kind === 'person') {
    if (a.gender) rows.push([t('fGender'), t(a.gender === 'm' ? 'male' : 'female')])
    if (a.top) rows.push([t('fTop'), `${t(a.top)}, ${colorName(a.top_color, lang)}`])
    if (a.bottom) rows.push([t('fBottom'), `${t(a.bottom)}, ${colorName(a.bottom_color, lang)}`])
    if (a.mask !== undefined) rows.push([t('fMask'), t(a.mask ? 'masked' : 'noMask')])
    if (a.accessories) rows.push([t('fAcc'), a.accessories.map(x => t(x as any)).join(', ') || '—'])
  } else {
    rows.push([t('type'), attrOf(d, lang)])
    if (d.plate) rows.push([t('plate'), <><span className="plate">{d.plate}</span> <span className={`text-xs ${(d.plate_confidence || 0) < 70 ? 'text-warn' : 'text-muted'}`}>{d.plate_confidence}%{(d.plate_confidence || 0) < 70 ? ` · ${L('cần xác minh', 'verify')}` : ''}</span></>])
  }
  rows.push([t('camera'), <>{d.camera_id}{d.camera_name ? <><br /><span className="text-muted">{d.camera_name}</span></> : null}</>])
  rows.push([t('appear'), <><span className="font-mono tabular">{hms(d.abs_in)} – {hms(d.abs_out)}</span><br /><span className="text-muted">{dmy(d.abs_in)} · {d.evidence_id}</span></>])
  rows.push([t('confidence'), `${d.confidence}%${d.similarity != null ? ` · ${L('tương đồng', 'similarity')} ${d.similarity}%` : ''}`])
  if (d.path.length > 1) rows.push([t('route'), d.path.map(p => p.camera_id).join(' → ')])

  const tag = async (col: string) => {
    try { await api('/api/tags', { body: { detection_id: d.id, color: col } }); setColor(col); qc.invalidateQueries({ queryKey: ['tags'] }); qc.invalidateQueries({ queryKey: ['search'] }); qc.invalidateQueries({ queryKey: ['overview'] }); toast(L(`Đã gắn thẻ ${d.track_id}`, `Tagged ${d.track_id}`), 'success') }
    catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  const addWatch = async () => {
    try { await api('/api/watch/from-detection', { body: { detection_id: d.id } }); qc.invalidateQueries({ queryKey: ['watch'] }); refreshCase(); closeModal(); toast(L('Đã thêm vào danh sách theo dõi', 'Added to the watchlist'), 'success') }
    catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  return (
    <Modal onClose={closeModal} size="sm:max-w-3xl" label={labelOf(d, lang)}>
      <div className="grid sm:grid-cols-2">
        <div className="relative bg-black aspect-[4/3] sm:aspect-auto sm:min-h-[440px]">
          <img src={media(d.crop_url)} className="absolute inset-0 w-full h-full object-contain" alt="" />
          {d.face_url && <img src={media(d.face_url)} className="absolute bottom-3 left-3 w-20 h-20 rounded-md object-cover ring-2 ring-white/80" alt={L('Khuôn mặt', 'Face')} />}
        </div>
        <div className="p-6 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4"><div><p className="label">{d.track_id} · {d.evidence_id}</p><h2 className="text-lg font-semibold mt-1">{labelOf(d, lang)}</h2></div>
            <button className="icon-btn -mr-2 -mt-2" aria-label={t('close')} onClick={closeModal}><Icon name="x" /></button></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">{rows.map(([k, val], i) => <div key={i} className="contents"><dt className="text-muted">{k}</dt><dd>{val}</dd></div>)}</dl>
          {can('tag', c) && <div><p className="label mb-2">{t('addTag')}</p><div className="flex flex-wrap gap-2">{TAG_COLORS.map(col => <Swatch key={col} color={col} pressed={color === col} onClick={() => tag(col)} />)}</div></div>}
          <p className="text-[11px] text-muted">{L('Kết quả AI là gợi ý; xác minh với dữ liệu gốc trước khi đưa vào hồ sơ.', 'AI results are leads; verify against the source before adding to the file.')}</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => gotoVideo(d.video_id, d.t_in, d.id, v?.case_id)}><Icon name="play" className="text-xs" />{t('viewInFootage')}</button>
            {d.kind === 'person' && <button className="btn btn-quiet" onClick={() => {
              const f = emptyFilters()
              if (a.gender) f.gender = [a.gender]
              if (a.top) f.top = [a.top]
              if (a.top_color) f.color = [a.top_color]
              useUI.setState({ filters: f, reportTab: 'person', tab: 'report', modal: null, searchMode: 'text', nlParsed: null })
            }}>{t('findSimilar')}</button>}
            {onWatch ? <span className="tag bg-danger/10 text-danger h-9 px-3 text-xs"><Icon name="shield-alert" className="text-sm" />{L('Trong danh sách theo dõi', 'On the watchlist')}</span>
              : can('watch.manage') && <button className="btn btn-quiet" onClick={addWatch}><Icon name="eye" />{L('Theo dõi', 'Watch')}</button>}
          </div>
        </div>
      </div>
    </Modal>
  )
}
