import { useEffect, useRef, useState } from 'react'
import { camGuess, defaultModes, FPS_OPTS, fpsOf, MODE_GROUPS, modeCount, SOURCES } from '../lib/domain'
import { fmt, fmtSize, shortHash } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, useCases, useWatch } from '../lib/queries'
import { closeModal, openModal } from '../lib/store'
import type { Modes } from '../lib/types'
import { readVideoMeta, startUpload, useUploads } from '../lib/upload'
import { Icon, Modal } from '../components/ui'

interface Pending { key: string; file: File; cam: string; meta: { duration: number; thumb: string | null } | null }
const OK_EXT = /\.(mp4|mov|avi|mkv)$/i
const MAX = 4 * 1024 ** 3
let seq = 1

export default function UploadDialog({ caseId: initial }: { caseId?: string }) {
  const { L, lang } = useT()
  const { data: cases = EMPTY } = useCases()
  const { data: watch } = useWatch()
  const [caseId, setCaseId] = useState(initial || cases[0]?.id || '')
  const [files, setFiles] = useState<Pending[]>([])
  const [fps, setFps] = useState('5')
  const [source, setSource] = useState('NVR')
  const [modes, setModes] = useState<Modes>(defaultModes())
  const [err, setErr] = useState('')
  const [started, setStarted] = useState<string[] | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const uploads = useUploads(s => s.items)
  const c = cases.find(x => x.id === caseId)

  const add = (list: FileList | File[]) => {
    setErr('')
    const next: Pending[] = []
    for (const f of Array.from(list)) {
      if (!f.type.startsWith('video/') && !OK_EXT.test(f.name)) { setErr(L(`'${f.name}' không phải file video. Chọn MP4, MOV, AVI hoặc MKV.`, `'${f.name}' is not a video. Choose MP4, MOV, AVI or MKV.`)); continue }
      if (!OK_EXT.test(f.name)) { setErr(L(`'${f.name}': định dạng chưa hỗ trợ. Chọn MP4, MOV, AVI hoặc MKV.`, `'${f.name}': unsupported format. Choose MP4, MOV, AVI or MKV.`)); continue }
      if (f.size > MAX) { setErr(L(`'${f.name}' vượt quá 4 GB.`, `'${f.name}' is larger than 4 GB.`)); continue }
      next.push({ key: `u${Date.now()}_${seq}`, file: f, cam: camGuess(f.name, seq++), meta: null })
    }
    setFiles(cur => {
      const merged = [...cur, ...next].slice(0, 20)
      if (cur.length + next.length > 20) setErr(L('Tối đa 20 tệp mỗi lần.', 'At most 20 files per batch.'))
      return merged
    })
    next.forEach(p => readVideoMeta(p.file).then(meta => setFiles(cur => cur.map(x => (x.key === p.key ? { ...x, meta } : x)))))
  }

  const nModes = modeCount(modes)
  const fpsN = fpsOf(fps)[3]
  const dur = files.reduce((a, p) => a + (p.meta?.duration || 60), 0)
  const eta = dur * fpsN * (0.04 + 0.015 * nModes)
  const fmtEta = (sec: number) => (sec < 60 ? L(`≈ ${Math.max(5, Math.round(sec / 5) * 5)} giây`, `≈ ${Math.max(5, Math.round(sec / 5) * 5)} s`) : L(`≈ ${Math.round(sec / 60)} phút`, `≈ ${Math.round(sec / 60)} min`))
  const why = !files.length ? L('Chọn ít nhất một video để tiếp tục.', 'Choose at least one video to continue.') : !nModes ? L('Chọn ít nhất một chế độ phân tích.', 'Choose at least one analysis mode.')
    : !can('video.upload', c) ? L('Vụ án đã kết thúc hoặc bạn không có quyền tải lên.', 'The case is closed or you cannot upload to it.') : ''

  const start = () => {
    if (why) return
    const keys = files.map(p => p.key)
    files.forEach(p => startUpload({ file: p.file, caseId, cameraId: p.cam, source, fps, modes, duration: p.meta?.duration }, p.key))
    setStarted(keys)
  }
  const allDone = started?.every(k => ['done', 'error'].includes(uploads[k]?.phase))
  useEffect(() => { if (!c && cases[0]) setCaseId(cases[0].id) }, [c, cases])

  const steps = [L('Chọn tệp', 'Choose files'), L('Cấu hình phân tích AI', 'Configure AI analysis'), L('Tải lên, tính mã băm, phân tích', 'Upload, hash, analyse')]
  return (
    <Modal onClose={closeModal} size="sm:max-w-2xl" label={L('Tải video vào vụ án', 'Upload video to case')}>
      <div className="flex flex-col max-h-[90vh]">
        <header className="px-6 pt-6 pb-4 border-b border-line">
          <h2 className="text-lg font-bold">{L('Tải video vào vụ án', 'Upload video to case')}</h2>
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-muted">
            {steps.map((x, i) => <li key={i} className={`flex items-center gap-1.5 ${(started ? i === 2 : i < 2) ? 'text-fg' : ''}`}>{i > 0 && <Icon name="chevron-right" className="text-xs" />}<span className="w-5 h-5 rounded-full bg-accent/10 text-accent grid place-items-center text-[11px] font-bold">{i + 1}</span>{x}</li>)}
          </ol>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">
          {started ? (<>
            <div><h3 className="text-sm font-bold">3. {L('Đang tải lên', 'Uploading')}</h3>
              <p className="text-xs text-muted mt-1">{fps === 'all' ? L('Toàn bộ khung hình', 'Every frame') : `${fps} FPS`} · {MODE_GROUPS.filter(g => Object.values(modes[g.k]).some(Boolean)).map(g => (lang === 'vi' ? g.vi : g.en)).join(', ')} · {SOURCES.find(s => s[0] === source)![lang === 'vi' ? 1 : 2]}</p></div>
            <ul className="space-y-3">{started.map(k => {
              const u = uploads[k]
              if (!u) return null
              const [evi, een] = (u.error || '').split('|')
              return <li key={k} className="p-3 rounded-lg ring-1 ring-line">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium truncate">{u.name}</span>
                  <span className="text-xs text-muted shrink-0">{u.phase === 'upload' ? `${L('Tải lên', 'Uploading')} ${u.pct}%` : u.phase === 'hash' ? L('Đang tính SHA-256…', 'Computing SHA-256…')
                    : u.phase === 'done' ? <span className="text-ok inline-flex items-center gap-1"><Icon name="circle-check" className="text-xs" />{u.evidenceId} · SHA-256 {shortHash(u.sha)} · {L('Đã tải lên, đang phân tích', 'Uploaded, analysing')}</span>
                    : <span className="text-danger">{lang === 'vi' ? evi : een || evi}</span>}</span></div>
                <div className="h-1 mt-2 rounded-full bg-line overflow-hidden"><div className={`h-full transition-all ${u.phase === 'done' ? 'bg-ok' : u.phase === 'error' ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${u.pct}%` }} /></div>
              </li>
            })}</ul>
          </>) : (<>
            <label className="block"><span className="label">{L('Vụ án', 'Case')}</span>
              <select className="inp mt-1.5" value={caseId} onChange={e => setCaseId(e.target.value)}>{cases.map(x => <option key={x.id} value={x.id}>{x.code} · {x.title}</option>)}</select></label>
            <section>
              <h3 className="text-sm font-bold">1. {L('Tệp video', 'Video files')}</h3>
              <div tabIndex={0} role="button" className={`mt-2 flex flex-col items-center justify-center gap-1 p-6 rounded-lg border-2 border-dashed ${drag ? 'border-accent bg-accent/5' : 'border-line2 bg-bg/60'} text-center cursor-pointer hover:border-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
                onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
                onDragEnter={e => { e.preventDefault(); setDrag(true) }} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files) }}>
                <Icon name="upload" className="text-accent text-xl mb-1" /><span className="text-sm font-semibold">{L('Kéo thả video vào đây', 'Drop video here')}</span>
                <span className="text-xs text-muted">{L('hoặc nhấn để chọn file · MP4, MOV, AVI, MKV, tối đa 4 GB, 20 tệp', 'or click to choose · MP4, MOV, AVI, MKV, up to 4 GB, 20 files')}</span>
                <input ref={input} type="file" accept="video/*,.mkv,.avi,.mov" multiple className="sr-only" onChange={e => { e.target.files && add(e.target.files); e.target.value = '' }} />
              </div>
              {err && <p className="text-sm text-danger mt-2" role="alert">{err}</p>}
              <ul className="mt-3 space-y-2">{files.map(p => (
                <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2 pr-1 rounded-lg ring-1 ring-line">
                  {p.meta?.thumb ? <img src={p.meta.thumb} className="w-16 h-9 rounded-sm object-cover bg-black shrink-0" alt="" /> : <span className="w-16 h-9 rounded-sm bg-black shrink-0 shimmer" />}
                  <span className="min-w-[150px] flex-1"><span className="block text-sm font-medium truncate" title={p.file.name}>{p.file.name}</span>
                    <span className="block text-xs text-muted">{fmtSize(p.file.size)} · {p.meta ? (p.meta.duration ? fmt(p.meta.duration) : L('thời lượng đọc sau khi tải lên', 'duration read after upload')) : L('Đang đọc…', 'Reading…')}</span></span>
                  <span className="flex items-center gap-1 w-full sm:w-auto">
                    <input className="inp h-8 w-full sm:w-[136px] text-xs font-mono uppercase" value={p.cam} aria-label={L('Mã camera', 'Camera ID')} data-tip={L('Mã camera đã ghi video này', 'ID of the camera that recorded this')}
                      onChange={e => setFiles(cur => cur.map(x => (x.key === p.key ? { ...x, cam: e.target.value.toUpperCase() } : x)))} />
                    <button type="button" className="icon-btn-sm shrink-0" aria-label={L('Bỏ tệp', 'Remove file')} onClick={() => setFiles(cur => cur.filter(x => x.key !== p.key))}><Icon name="x" /></button>
                  </span>
                </li>
              ))}</ul>
            </section>
            <section className="space-y-4">
              <h3 className="text-sm font-bold">2. {L('Cấu hình phân tích AI', 'AI analysis settings')}</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block"><span className="label flex items-center gap-1">{L('Khung hình (FPS)', 'Frame rate (FPS)')}<span className="text-muted" data-tip={L('Số khung hình AI xét trong mỗi giây video. Càng cao càng chính xác nhưng càng lâu.', 'How many frames per second of video the AI examines. Higher is more accurate but slower.')}><Icon name="info" className="text-xs" /></span></span>
                  <select className="inp mt-1.5" value={fps} onChange={e => setFps(e.target.value)}>{FPS_OPTS.map(o => <option key={o[0]} value={o[0]}>{lang === 'vi' ? o[1] : o[2]}</option>)}</select>
                  <span className={`block text-xs mt-1.5 leading-5 ${['0.5', '0.2'].includes(fps) ? 'text-warn' : 'text-muted'}`}>{fpsOf(fps)[lang === 'vi' ? 4 : 5]}</span></label>
                <label className="block"><span className="label">{L('Nguồn video', 'Video source')}</span>
                  <select className="inp mt-1.5" value={source} onChange={e => setSource(e.target.value)}>{SOURCES.map(s => <option key={s[0]} value={s[0]}>{lang === 'vi' ? s[1] : s[2]}</option>)}</select>
                  <span className="block text-xs text-muted mt-1.5 leading-5">{L('Ghi vào hồ sơ chuỗi lưu giữ chứng cứ.', 'Recorded in the chain-of-custody file.')}</span></label>
              </div>
              <p className="flex items-start gap-2 p-3 rounded-lg bg-accent/5 ring-1 ring-inset ring-accent/20 text-xs"><Icon name="eye" className="text-accent text-sm shrink-0" />
                <span>{L(`Video mới sẽ được đối chiếu với danh sách theo dõi (${watch?.faces.length || 0} khuôn mặt, ${watch?.plates.length || 0} biển số) ngay khi phân tích; khớp sẽ cảnh báo sớm.`, `New videos are checked against the watchlist (${watch?.faces.length || 0} faces, ${watch?.plates.length || 0} plates) during analysis; a match raises an early alert.`)}{' '}
                  <button type="button" className="text-accent underline underline-offset-2 cursor-pointer" onClick={() => openModal('watchlist', { back: 'upload' })}>{L('Xem danh sách', 'Open list')}</button></span></p>
              <fieldset><legend className="label">{L('Chế độ phân tích', 'Analysis modes')}</legend>
                <div className="grid sm:grid-cols-2 gap-3 mt-1.5">{MODE_GROUPS.map(g => {
                  const vals = Object.values(modes[g.k])
                  const all = vals.every(Boolean), some = vals.some(Boolean)
                  return <div key={g.k} className="rounded-lg ring-1 ring-line p-3">
                    <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-[rgb(var(--accent))]" checked={all} ref={el => { if (el) el.indeterminate = some && !all }}
                      onChange={() => setModes(m => ({ ...m, [g.k]: Object.fromEntries(Object.keys(m[g.k]).map(k => [k, !all])) }))} />
                      <span className="w-7 h-7 rounded-md bg-accent/10 text-accent grid place-items-center"><Icon name={g.icon} className="text-sm" /></span><span className="text-sm font-semibold">{lang === 'vi' ? g.vi : g.en}</span></label>
                    <div className="grid grid-cols-1 gap-1.5 mt-2.5 pl-6">{g.subs.map(([k, vi, en]) => (
                      <label key={k} className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" className="w-4 h-4 accent-[rgb(var(--accent))]" checked={(modes[g.k] as any)[k]}
                        onChange={e => setModes(m => ({ ...m, [g.k]: { ...m[g.k], [k]: e.target.checked } }))} />{lang === 'vi' ? vi : en}</label>
                    ))}</div>
                  </div>
                })}</div>
                {!nModes && <p className="text-xs text-danger mt-1.5" role="alert">{L('Chọn ít nhất một chế độ phân tích.', 'Choose at least one analysis mode.')}</p>}
              </fieldset>
            </section>
          </>)}
        </div>
        <footer className="px-6 py-4 border-t border-line flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted flex-1 min-w-[180px]">
            {started ? L('Bạn có thể đóng cửa sổ này; video vẫn tải lên và phân tích ở nền.', 'You can close this window; upload and analysis continue in the background.')
              : why ? <span className="inline-flex items-center gap-1.5"><Icon name="info" className="text-sm" />{why}</span>
              : <><span className="text-fg font-semibold">{files.length} {L('tệp', 'files')}</span> · {fmt(dur)} · {fps === 'all' ? L('toàn bộ khung hình', 'every frame') : `${fps} FPS`} · {nModes} {L('chế độ', 'modes')}<br />
                {L('Thời gian phân tích ước tính', 'Estimated analysis time')} <span className="text-fg font-semibold">{fmtEta(eta)}</span></>}
          </p>
          <span className="flex gap-2 ml-auto">
            {started ? <button className="btn btn-primary" onClick={closeModal}>{allDone ? L('Xong', 'Done') : L('Đóng, chạy nền', 'Close, keep running')}</button> : <>
              <button type="button" className="btn btn-quiet" onClick={closeModal}>{L('Hủy', 'Cancel')}</button>
              <button className="btn btn-primary" disabled={!!why} onClick={start}><Icon name="upload" />{L('Tải lên và phân tích', 'Upload and analyse')}</button></>}
          </span>
        </footer>
      </div>
    </Modal>
  )
}
