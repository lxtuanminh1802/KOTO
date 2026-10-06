import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, ApiError, getSession, media, setSession } from '../lib/api'
import { defaultModes, FPS_OPTS, fpsOf, MODE_GROUPS, modeCount } from '../lib/domain'
import { useT } from '../lib/i18n'
import { EMPTY, qc, refreshCase, useUsers, useVideos } from '../lib/queries'
import { closeModal, toast, useUI } from '../lib/store'
import type { Case, Modes, Video } from '../lib/types'
import { FieldError, Icon, Modal, Switch } from '../components/ui'
import { saveSetting } from '../components/Header'

type Errs = Record<string, string>
const fieldErrs = (e: unknown, lang: 'vi' | 'en'): Errs => {
  if (!(e instanceof ApiError)) return { _: String(e) }
  const f = (e.extra.fields || {}) as Record<string, { vi: string; en: string }>
  const out: Errs = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v[lang]]))
  if (e.extra.field) out[e.extra.field as string] = e.msg(lang)
  if (!Object.keys(out).length) out._ = e.msg(lang)
  return out
}

/* ------------------------------------------------------------------ UR-CASE-01 */
export function NewCaseDialog() {
  const { L, lang } = useT()
  const me = getSession()!.user
  const { data: users = EMPTY } = useUsers()
  const { data: next } = useQuery({ queryKey: ['nextCode'], queryFn: () => api<{ code: string }>('/api/cases/next-code') })
  const [code, setCode] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [decision, setDecision] = useState('')
  const [lead, setLead] = useState(me.id)
  const [errs, setErrs] = useState<Errs>({})
  const val = code ?? next?.code ?? ''
  const check = () => {
    const e: Errs = {}
    if (!/^[A-ZĐ]{1,4}-\d{2,5}$/i.test(val.trim())) e.code = L('Dạng mã: VA-125', 'Format: VA-125')
    if (title.trim().length < 3) e.title = L('Tên vụ án tối thiểu 3 ký tự', 'At least 3 characters')
    setErrs(e)
    return !Object.keys(e).length
  }
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!check()) return
    try {
      const c = await api<Case>('/api/cases', { body: { code: val.trim().toUpperCase(), title, decision_no: decision, lead_user_id: lead } })
      await qc.invalidateQueries({ queryKey: ['cases'] })
      qc.invalidateQueries({ queryKey: ['nextCode'] })
      useUI.setState({ caseId: c.id, tab: 'case', videoId: null, modal: null })
      toast(L(`Đã tạo vụ án ${c.code}`, `Case ${c.code} created`), 'success')
    } catch (e) { setErrs(fieldErrs(e, lang)) }
  }
  return (
    <Modal onClose={closeModal} label={L('Thêm vụ án', 'New case')}>
      <form noValidate className="p-6 space-y-4" onSubmit={submit}>
        <div><h2 className="text-base font-semibold">{L('Thêm vụ án', 'New case')}</h2><p className="text-sm text-muted mt-1">{L('Tạo hồ sơ trước, sau đó tải video chứng cứ lên vụ án.', 'Create the case file first, then upload video evidence into it.')}</p></div>
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <label className="block"><span className="label">{L('Mã vụ án', 'Case ID')}</span><input className="inp mt-2 font-mono uppercase" value={val} aria-invalid={!!errs.code} onChange={e => setCode(e.target.value.toUpperCase())} /><FieldError msg={errs.code} /></label>
          <label className="block"><span className="label">{L('Tên vụ án', 'Case name')}</span><input className="inp mt-2" value={title} aria-invalid={!!errs.title} placeholder={L('Ví dụ: Trộm xe máy, phố Huế', 'e.g. Motorbike theft, Hue street')} onChange={e => setTitle(e.target.value)} /><FieldError msg={errs.title} /></label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="block"><span className="label">{L('Số quyết định', 'Decision no.')}</span><input className="inp mt-2 font-mono" value={decision} placeholder={`${val.split('-')[1] || ''}/QĐ`} onChange={e => setDecision(e.target.value)} /></label>
          <label className="block"><span className="label">{L('Điều tra viên phụ trách', 'Lead investigator')}</span>
            <select className="inp mt-2" value={lead} onChange={e => setLead(e.target.value)}>{users.filter(u => u.role === 'INVESTIGATOR' || u.id === me.id).map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select><FieldError msg={errs.lead_user_id} /></label>
        </div>
        <FieldError msg={errs._} />
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button><button className="btn btn-primary"><Icon name="folder-plus" />{L('Tạo vụ án', 'Create case')}</button></div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-CASE-07 */
export function EditCaseDialog({ c }: { c: Case }) {
  const { L, lang } = useT()
  const me = getSession()!.user
  const { data: users = EMPTY } = useUsers()
  const [title, setTitle] = useState(c.title)
  const [decision, setDecision] = useState(c.decision_no)
  const [lead, setLead] = useState(c.lead_user_id)
  const [status, setStatus] = useState(c.status)
  const [err, setErr] = useState('')
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    try {
      await api(`/api/cases/${c.id}`, { method: 'PATCH', body: { title, decision_no: decision, lead_user_id: lead, status } })
      refreshCase()
      closeModal()
      toast(L('Đã cập nhật vụ án', 'Case updated'), 'success')
    } catch (e) { if (e instanceof ApiError) setErr(e.msg(lang)) }
  }
  return (
    <Modal onClose={closeModal} label={L('Sửa vụ án', 'Edit case')}>
      <form className="p-6 space-y-4" onSubmit={submit}>
        <h2 className="text-base font-semibold">{L('Sửa vụ án', 'Edit case')} <span className="font-mono text-muted">{c.code}</span></h2>
        <label className="block"><span className="label">{L('Tên vụ án', 'Case name')}</span><input className="inp mt-2" value={title} onChange={e => setTitle(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block"><span className="label">{L('Số quyết định', 'Decision no.')}</span><input className="inp mt-2 font-mono" value={decision} onChange={e => setDecision(e.target.value)} /></label>
          <label className="block"><span className="label">{L('Điều tra viên phụ trách', 'Lead investigator')}</span>
            <select className="inp mt-2" value={lead} onChange={e => setLead(e.target.value)}>{users.filter(u => u.role === 'INVESTIGATOR').map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label>
        </div>
        <label className="block"><span className="label">{L('Trạng thái', 'Status')}</span>
          <select className="inp mt-2" value={status} onChange={e => setStatus(e.target.value as Case['status'])}>
            <option value="ACTIVE">{L('Đang điều tra', 'Under investigation')}</option><option value="SUSPENDED">{L('Tạm đình chỉ', 'Suspended')}</option>
            <option value="CLOSED" disabled={me.role !== 'COMMANDER'}>{L('Đã kết thúc (cần quyền Chỉ huy)', 'Closed (commander only)')}</option></select></label>
        <FieldError msg={err} />
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button><button className="btn btn-primary">{L('Lưu', 'Save')}</button></div>
      </form>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-ANA-07 */
export function ReanalyzeDialog({ video }: { video: Video }) {
  const { L, lang } = useT()
  const [fps, setFps] = useState(video.analysis.fps || '5')
  const [modes, setModes] = useState<Modes>(video.analysis.modes?.person ? video.analysis.modes : defaultModes())
  const n = modeCount(modes)
  const submit = async () => {
    try {
      await api(`/api/videos/${video.id}/reanalyze`, { body: { fps, modes } })
      refreshCase()
      closeModal()
      toast(L('Đã đưa vào hàng đợi phân tích lại', 'Re-analysis queued'), 'success')
    } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  return (
    <Modal onClose={closeModal} label={L('Phân tích lại', 'Re-analyse')}>
      <div className="p-6 space-y-4">
        <div><h2 className="text-base font-semibold">{L('Phân tích lại', 'Re-analyse')}</h2><p className="text-sm text-muted mt-1"><span className="font-mono">{video.evidence_id}</span> · {video.name}</p></div>
        <label className="block"><span className="label">{L('Khung hình (FPS)', 'Frame rate (FPS)')}</span>
          <select className="inp mt-1.5" value={fps} onChange={e => setFps(e.target.value)}>{FPS_OPTS.map(o => <option key={o[0]} value={o[0]}>{lang === 'vi' ? o[1] : o[2]}</option>)}</select>
          <span className="block text-xs text-muted mt-1.5">{fpsOf(fps)[lang === 'vi' ? 4 : 5]}</span></label>
        <div className="grid sm:grid-cols-2 gap-3">{MODE_GROUPS.map(g => (
          <div key={g.k} className="rounded-lg ring-1 ring-line p-3"><p className="text-sm font-semibold flex items-center gap-2"><Icon name={g.icon} className="text-accent" />{lang === 'vi' ? g.vi : g.en}</p>
            {g.subs.map(([k, vi, en]) => <label key={k} className="flex items-center gap-2 text-sm mt-1.5 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-[rgb(var(--accent))]" checked={(modes[g.k] as any)[k]} onChange={e => setModes(m => ({ ...m, [g.k]: { ...m[g.k], [k]: e.target.checked } }))} />{lang === 'vi' ? vi : en}</label>)}
          </div>
        ))}</div>
        <p className="text-xs text-muted">{L('Kết quả cũ được giữ thành phiên bản; thẻ và vùng giữ nguyên và được tính lại trên kết quả mới (Q06).', 'Earlier results are kept as a version; tags and zones stay and are recomputed on the new results (Q06).')}</p>
        <div className="flex justify-end gap-2"><button className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button><button className="btn btn-primary" disabled={!n} onClick={submit}><Icon name="refresh" />{L('Phân tích lại', 'Re-analyse')}</button></div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-EVD-10, UR-CLIP-05 */
export function DeleteVideoDialog({ video }: { video: Video }) {
  const { L, lang } = useT()
  const { data: videos = EMPTY } = useVideos()
  const clips = videos.filter(v => v.parent_id === video.id && v.state !== 'REMOVED').length
  const submit = async () => {
    try {
      await api(`/api/videos/${video.id}`, { method: 'DELETE' })
      if (useUI.getState().videoId === video.id) useUI.setState({ videoId: null, playing: false })
      refreshCase()
      closeModal()
      toast(L('Đã gỡ chứng cứ khỏi vụ án', 'Evidence removed from the case'))
    } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  return (
    <Modal onClose={closeModal} size="sm:max-w-md" label={L('Gỡ chứng cứ', 'Remove evidence')}>
      <div className="p-6 space-y-4">
        <h2 className="text-base font-semibold">{L('Gỡ video này khỏi vụ án?', 'Remove this video from the case?')}</h2>
        <p className="text-sm text-muted"><span className="text-fg font-mono">{video.evidence_id}</span> <span className="text-fg">{video.name}</span>.{' '}
          {L('Kết quả phân tích, thẻ, ảnh chụp liên quan cũng bị gỡ.', 'Its analysis, tags and snapshots are removed too.')}
          {clips ? <b className="text-fg"> {L(`Kèm ${clips} đoạn cắt.`, `Including ${clips} clips.`)}</b> : null}{' '}
          {L('Dữ liệu được giữ trong kho theo chính sách lưu trữ và hành động được ghi nhật ký.', 'Data stays in storage per the retention policy and the action is logged.')}</p>
        <div className="flex justify-end gap-2 pt-2"><button className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button><button className="btn btn-danger" onClick={submit}><Icon name="trash" />{L('Gỡ chứng cứ', 'Remove')}</button></div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-SET-01 */
export function SettingsDialog() {
  const { t, L } = useT()
  const s = getSession()!.user.settings
  const [minConf, setMinConf] = useState(s.min_conf)
  const [wm, setWm] = useState(s.watermark)
  const [redact, setRedact] = useState(s.auto_redact)
  const [notify, setNotify] = useState(s.notify)
  const [idle, setIdle] = useState(s.idle_lock_minutes)
  const [pin, setPin] = useState({ pw: '', pin: '', err: '' })
  const { data: videos = EMPTY } = useVideos()
  const caseId = useUI(x => x.caseId)
  const { data: dets } = useQuery({
    queryKey: ['allconf', caseId],
    queryFn: async () => (await Promise.all(videos.filter(v => v.case_id === caseId && !v.parent_id && v.state === 'ANALYZED').map(v => api<{ detections: { confidence: number }[] }>(`/api/videos/${v.id}/detections`)))).flatMap(x => x.detections),
  })
  const shown = (dets || []).filter(d => d.confidence >= minConf).length
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    await saveSetting({ min_conf: minConf, watermark: wm, auto_redact: redact, notify, idle_lock_minutes: idle })
    refreshCase()
    closeModal()
    toast(t('tSaved'), 'success')
  }
  const savePin = async () => {
    try {
      await api('/api/me/pin', { method: 'PUT', body: { password: pin.pw, pin: pin.pin } })
      const ss = getSession()!
      setSession({ ...ss, user: { ...ss.user, has_pin: true } })
      setPin({ pw: '', pin: '', err: '' })
      toast(L('Đã đổi mã PIN', 'PIN changed'), 'success')
    } catch (e) { if (e instanceof ApiError) setPin(p => ({ ...p, err: e.msg(useUI.getState().lang) })) }
  }
  return (
    <Modal onClose={closeModal} size="sm:max-w-md" label={t('settings')}>
      <form className="p-6 space-y-6" onSubmit={save}>
        <div className="flex items-start justify-between gap-4"><h2 className="text-base font-semibold">{t('settings')}</h2><button type="button" className="icon-btn -mr-2 -mt-2" aria-label={t('close')} onClick={closeModal}><Icon name="x" /></button></div>
        <div>
          <div className="flex items-center justify-between text-sm mb-2"><label htmlFor="setConf">{t('minConf')}</label><output className="font-mono tabular text-muted">{minConf}%</output></div>
          <input id="setConf" type="range" className="rng" min={50} max={99} value={minConf} style={{ ['--p' as any]: `${((minConf - 50) / 49) * 100}%` }} onChange={e => setMinConf(+e.target.value)} />
          <p className="text-xs text-muted mt-2">{t('minConfHint')}</p>
          {dets && <p className="text-xs mt-1 tabular">{t('showing', { a: shown, b: dets.length })}</p>}
        </div>
        <div className="divide-y divide-line">
          <Switch label={t('sWatermark')} checked={wm} onChange={setWm} />
          <Switch label={t('sRedact')} checked={redact} onChange={setRedact} />
          <Switch label={t('sNotify')} checked={notify} onChange={setNotify} />
          <label className="flex items-center justify-between gap-4 h-11 text-sm"><span>{t('idleLock')}</span>
            <select className="inp w-28 h-8" value={idle} onChange={e => setIdle(+e.target.value)}>{[5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} {L('phút', 'min')}</option>)}</select></label>
        </div>
        <details className="group rounded-lg ring-1 ring-line p-3"><summary className="text-sm cursor-pointer list-none flex items-center justify-between">{L('Đổi mã PIN khóa phiên', 'Change session-lock PIN')}<Icon name="chevron-down" className="text-xs group-open:rotate-180" /></summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <input className="inp" type="password" placeholder={L('Mật khẩu hiện tại', 'Current password')} value={pin.pw} onChange={e => setPin(p => ({ ...p, pw: e.target.value }))} />
            <input className="inp font-mono" inputMode="numeric" maxLength={6} placeholder="PIN" value={pin.pin} onChange={e => setPin(p => ({ ...p, pin: e.target.value.replace(/\D/g, '') }))} />
          </div><FieldError msg={pin.err} />
          <button type="button" className="btn btn-quiet h-8 text-xs mt-3" disabled={pin.pin.length !== 6 || !pin.pw} onClick={savePin}>{L('Lưu PIN', 'Save PIN')}</button>
        </details>
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-quiet" onClick={closeModal}>{t('cancel')}</button><button className="btn btn-primary">{t('save')}</button></div>
      </form>
    </Modal>
  )
}

export function ShortcutsDialog() {
  const { t } = useT()
  const k = (...keys: string[]) => <span className="flex gap-1">{keys.map(x => <span key={x} className="kbd">{x}</span>)}</span>
  const groups: [string, [React.ReactElement, string][]][] = [
    [t('kGroupPlay'), [[k('Space'), t('kPlay')], [k('←', '→'), t('kSeek')], [k('Shift', '←'), t('kFine')], [k('I', 'O'), t('kRange')]]],
    [t('kGroupWork'), [[k('B'), t('bookmarkL')], [k('S'), t('snapshotL')]]],
    [t('kGroupApp'), [[k('/'), t('kAi')], [k('?'), t('kShortcuts')], [k('Esc'), t('kEsc')]]],
  ]
  return (
    <Modal onClose={closeModal} size="sm:max-w-md" label={t('shortcuts')}>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4"><h2 className="text-base font-semibold">{t('shortcuts')}</h2><button className="icon-btn -mr-2 -mt-2" aria-label={t('close')} onClick={closeModal}><Icon name="x" /></button></div>
        {groups.map(([g, rows]) => (
          <section key={g}><p className="label mb-2">{g}</p><dl className="divide-y divide-line">{rows.map(([keys, d]) => <div key={d} className="flex items-center justify-between h-10 text-sm"><dt>{d}</dt><dd>{keys}</dd></div>)}</dl></section>
        ))}
      </div>
    </Modal>
  )
}

const WELCOME: [string, [string, string], [string, string]][] = [
  ['folder-plus', ['Tạo vụ án', 'Create a case'], ['Mỗi vụ án là một thư mục chứa toàn bộ video chứng cứ, kết quả và báo cáo.', 'A case is a folder holding all video evidence, results and the report.']],
  ['upload', ['Tải video lên', 'Upload video'], ['Hệ thống tính mã SHA-256 để bảo toàn chứng cứ, rồi AI nhận diện người, khuôn mặt, phương tiện, biển số.', 'The system hashes it with SHA-256, then AI detects people, faces, vehicles and plates.']],
  ['scissors', ['Xem và cắt đoạn', 'Review and cut'], ['Tua tới đoạn quan trọng, bấm In và Out, rồi cắt thành video con dưới video gốc.', 'Find the key moment, press In and Out, and cut it into a child video.']],
  ['file-down', ['Tìm, đánh dấu, báo cáo', 'Find, tag, report'], ['Tìm đối tượng bằng mô tả, gắn thẻ, rồi xuất báo cáo PDF có mã băm.', 'Find subjects by description, tag them, then export a hashed PDF report.']],
]

/* ------------------------------------------------------------------ UR-HELP-01 */
export function WelcomeDialog() {
  const { L, lang } = useT()
  const seen = () => {
    api('/api/me/welcome-seen', { method: 'POST' }).catch(() => {})
    const s = getSession()
    if (s) setSession({ ...s, user: { ...s.user, welcome_seen: true } })
  }
  return (
    <Modal onClose={() => { seen(); closeModal() }} size="sm:max-w-2xl" label={L('Chào mừng', 'Welcome')}>
      <div className="p-6 sm:p-8">
        <span className="inline-grid place-items-center h-10 px-2 rounded-md bg-white ring-1 ring-line"><img src="/aipt-logo.png" alt="AIPT Group" className="h-7 w-auto" /></span>
        <h2 className="text-2xl font-bold tracking-tight mt-4">{L('Chào mừng đến Video Master AI', 'Welcome to Video Master AI')}</h2>
        <p className="text-sm text-muted mt-1">{L('Xử lý video chứng cứ trong 4 bước. Bạn có thể xem lại hướng dẫn bất cứ lúc nào ở nút Hướng dẫn.', 'Handle video evidence in four steps. Reopen this guide any time from Help.')}</p>
        <ol className="grid sm:grid-cols-2 gap-3 mt-6">{WELCOME.map(([icon, ti, d], i) => (
          <li key={i} className="flex gap-3 p-4 rounded-lg ring-1 ring-line bg-bg/60">
            <span className="w-9 h-9 rounded-md bg-accent/10 text-accent grid place-items-center shrink-0"><Icon name={icon} /></span>
            <span><span className="block text-sm font-bold">{i + 1}. {ti[lang === 'vi' ? 0 : 1]}</span><span className="block text-xs text-muted mt-1 leading-5">{d[lang === 'vi' ? 0 : 1]}</span></span>
          </li>
        ))}</ol>
        <div className="flex flex-wrap justify-end gap-2 mt-6">
          <button className="btn btn-quiet" onClick={() => { seen(); closeModal() }}>{L('Tự khám phá', 'Explore on my own')}</button>
          <button className="btn btn-primary" onClick={() => { seen(); useUI.setState({ modal: null, tour: 0 }) }}>{L('Xem hướng dẫn từng bước', 'Take the guided tour')}<Icon name="arrow-right" /></button>
        </div>
      </div>
    </Modal>
  )
}

export function ExportedDialog({ file_name, sha256, url }: { file_name: string; sha256: string; url: string }) {
  const { L } = useT()
  return (
    <Modal onClose={closeModal} size="sm:max-w-2xl" label={L('Ảnh đã xuất', 'Exported image')}>
      <div className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="text-base font-semibold">{L('Ảnh đã xuất', 'Exported image')}</h2>
          <p className="text-xs text-muted font-mono mt-1 break-all">{file_name} · SHA-256 {sha256}</p></div><button className="icon-btn -mr-2 -mt-2" aria-label={L('Đóng', 'Close')} onClick={closeModal}><Icon name="x" /></button></div>
        <img src={media(url)} className="w-full rounded-md border border-line bg-black" alt={file_name} />
        <p className="text-xs text-muted">{L('Ảnh đã xử lý bằng AI là bản phái sinh, không phải ảnh gốc. Thao tác đã ghi nhật ký.', 'The AI-processed image is a derivative, not the original. The export is logged.')}</p>
        <div className="flex justify-end gap-2"><button className="btn btn-quiet" onClick={closeModal}>{L('Đóng', 'Close')}</button><a className="btn btn-primary" href={media(url)} download={file_name}><Icon name="download" />{L('Lưu tệp', 'Save file')}</a></div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-MAP-03 */
export function CoordDialog({ lat = '', lng = '' }: { lat?: string; lng?: string }) {
  const { L, lang } = useT()
  const { data: videos = EMPTY } = useVideos()
  const roots = videos.filter(v => !v.parent_id && v.state !== 'REMOVED' && v.state !== 'REJECTED')
  const unplaced = roots.filter(v => v.camera?.lat == null)
  const placed = roots.filter(v => v.camera?.lat != null)
  const [video, setVideo] = useState(unplaced[0]?.id || '')
  const [id, setId] = useState(unplaced[0]?.camera_id || '')
  const [place, setPlace] = useState('')
  const [la, setLa] = useState(lat)
  const [ln, setLn] = useState(lng)
  const [errs, setErrs] = useState<Errs>({})
  const check = () => {
    const e: Errs = {}
    if (!id.trim()) e.id = L('Nhập mã camera', 'Enter a camera ID')
    if (la === '' || isNaN(+la) || Math.abs(+la) > 90) e.lat = L('Vĩ độ nằm trong khoảng −90 đến 90', 'Latitude must be between −90 and 90')
    if (ln === '' || isNaN(+ln) || Math.abs(+ln) > 180) e.lng = L('Kinh độ nằm trong khoảng −180 đến 180', 'Longitude must be between −180 and 180')
    setErrs(e)
    return !Object.keys(e).length
  }
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!check()) return
    try {
      await api('/api/cameras', { body: { id, name: place, lat: +la, lng: +ln, video_id: video || null } })
      refreshCase()
      qc.invalidateQueries({ queryKey: ['cameras'] })
      closeModal()
      const v = videos.find(x => x.id === video)
      toast(v ? L(`Đã gán ${v.evidence_id} vào ${id.toUpperCase()}`, `Assigned ${v.evidence_id} to ${id.toUpperCase()}`) : L(`Đã lưu camera ${id.toUpperCase()}`, `Camera ${id.toUpperCase()} saved`), 'success')
    } catch (e) { setErrs(fieldErrs(e, lang)) }
  }
  const opt = (v: Video) => <option key={v.id} value={v.id}>{v.evidence_id} · {v.name}{v.camera?.lat != null ? ` (${L('đang ở', 'now at')} ${v.camera_id})` : ''}</option>
  return (
    <Modal onClose={closeModal} size="sm:max-w-md" label={L('Thêm camera', 'Add camera')}>
      <form noValidate className="p-6 space-y-4" onSubmit={submit}>
        <div><h2 className="text-base font-semibold">{L('Thêm camera', 'Add camera')}</h2><p className="text-sm text-muted mt-1">{L('Gán vị trí cho video chứng cứ để đối tượng của nó xuất hiện trên lộ trình.', 'Give a video exhibit a location so its subjects appear on routes.')}</p></div>
        <label className="block"><span className="label">{L('Gán cho video', 'Assign to video')}</span>
          <select className="inp mt-2" value={video} onChange={e => { setVideo(e.target.value); const v = videos.find(x => x.id === e.target.value); if (v) setId(v.camera_id) }}>
            <option value="">{L('Không gán, chỉ thêm camera', 'None, add camera only')}</option>
            {unplaced.length > 0 && <optgroup label={L('Chưa có vị trí', 'No location yet')}>{unplaced.map(opt)}</optgroup>}
            {placed.length > 0 && <optgroup label={L('Đổi vị trí', 'Relocate')}>{placed.map(opt)}</optgroup>}
          </select></label>
        <label className="block"><span className="label">{L('Mã camera', 'Camera ID')}</span><input className="inp mt-2 font-mono uppercase" placeholder="CAM_HK_030" value={id} aria-invalid={!!errs.id} onChange={e => setId(e.target.value.toUpperCase())} /><FieldError msg={errs.id} /></label>
        <label className="block"><span className="label">{L('Mô tả vị trí', 'Location note')}</span><input className="inp mt-2" placeholder={L('Ví dụ: Phố Huế giao Hàng Bài', 'e.g. Hue St at Hang Bai')} value={place} onChange={e => setPlace(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block"><span className="label">{L('Vĩ độ', 'Latitude')}</span><input className="inp mt-2 font-mono" inputMode="decimal" placeholder="21.0285" value={la} aria-invalid={!!errs.lat} onChange={e => setLa(e.target.value)} /><FieldError msg={errs.lat} /></label>
          <label className="block"><span className="label">{L('Kinh độ', 'Longitude')}</span><input className="inp mt-2 font-mono" inputMode="decimal" placeholder="105.8542" value={ln} aria-invalid={!!errs.lng} onChange={e => setLn(e.target.value)} /><FieldError msg={errs.lng} /></label>
        </div>
        <FieldError msg={errs._} />
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button><button className="btn btn-primary"><Icon name="map-pin" />{L('Lưu vị trí', 'Save location')}</button></div>
      </form>
    </Modal>
  )
}
