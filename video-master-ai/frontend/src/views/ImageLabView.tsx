import { useEffect, useRef, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { clamp, copyText, fmt } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, qc, useCases, useSnapshots } from '../lib/queries'
import { labDefaults, openModal, toast, useUI, type LabState } from '../lib/store'
import type { Annotation, Snapshot } from '../lib/types'
import { Empty, Icon, Switch } from '../components/ui'

const MANUAL = [
  { k: 'bright', min: 0, max: 200, step: 1, f: (v: number) => v + '%' }, { k: 'contrast', min: 0, max: 200, step: 1, f: (v: number) => v + '%' },
  { k: 'sat', min: 0, max: 200, step: 1, f: (v: number) => v + '%' }, { k: 'sharp', min: 0, max: 3, step: 0.1, f: (v: number) => v.toFixed(1) },
  { k: 'zoom', key: 'zoomL', min: 1, max: 4, step: 0.1, f: (v: number) => v.toFixed(1) + '×' },
] as const
const SCENES: Record<string, { key: 'sPlate' | 'sNight' | 'sBlur' | 'sFace'; b: number; c: number; s: number; k: number }> = {
  plate: { key: 'sPlate', b: 100, c: 160, s: 60, k: 2 }, night: { key: 'sNight', b: 150, c: 125, s: 90, k: 0.8 },
  blur: { key: 'sBlur', b: 100, c: 115, s: 100, k: 2.4 }, face: { key: 'sFace', b: 112, c: 112, s: 100, k: 1.2 },
}

const aiActive = (l: LabState) => { const m = l.manual; return l.oneTouch || !!l.scene || l.opts.deblur || l.opts.denoise || m.bright !== 100 || m.contrast !== 100 || m.sat !== 100 || m.sharp > 0 || m.gray || m.invert || m.edge }
function labParams(l: LabState) {
  let b = 100, c = 100, s = 100, k = 0
  if (l.oneTouch) { b = 112; c = 122; s = 104; k = 1 }
  if (l.scene) { const sc = SCENES[l.scene]; b = sc.b; c = sc.c; s = sc.s; k = sc.k }
  if (l.opts.deblur) k += 1
  if (l.opts.denoise) { k = Math.max(0, k - 0.3); s -= 6 }
  const m = l.manual
  return { b: (b * m.bright) / 100, c: (c * m.contrast) / 100, s: (s * m.sat) / 100, k: k + m.sharp, gray: m.gray, invert: m.invert, edge: m.edge }
}
const labCss = (p: ReturnType<typeof labParams>) => [p.k > 0 ? 'url(#fSharpI)' : '', p.edge ? 'url(#fEdge)' : '', `brightness(${p.b.toFixed(0)}%)`, `contrast(${p.c.toFixed(0)}%)`, `saturate(${p.s.toFixed(0)}%)`, p.gray ? 'grayscale(1)' : '', p.invert ? 'invert(1)' : ''].filter(Boolean).join(' ')

export default function ImageLabView() {
  const { t, L, lang } = useT()
  const { caseId, lab, labPanelOpen, set } = useUI()
  const setLab = (p: Partial<LabState> | ((l: LabState) => Partial<LabState>)) => set(s => ({ lab: { ...s.lab, ...(typeof p === 'function' ? p(s.lab) : p) } }))
  const { data } = useSnapshots(caseId)
  const { data: cases = EMPTY } = useCases()
  const c = cases.find(x => x.id === caseId)
  const snaps = data?.snapshots || []
  const snap = snaps.find(s => s.id === lab.snapId) || snaps[0]
  const stage = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const p = labParams(lab)
  const on = aiActive(lab)
  const editable = can('video.edit', c)

  useEffect(() => { if (snap && lab.snapId !== snap.id) setLab({ snapId: snap.id }) }, [snap?.id])

  const run = (text: string, ms: number, done: () => void) => { setBusy(text); setTimeout(() => { setBusy(null); done() }, ms) }

  // Stage interactions: compare divider, pan when zoomed, region select (UR-IMG-04).
  const drag = useRef<{ mode: string; sx: number; sy: number } | null>(null)
  const pct = (e: React.PointerEvent | PointerEvent) => { const r = stage.current!.getBoundingClientRect(); return { x: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100), y: clamp(((e.clientY - r.top) / r.height) * 100, 0, 100) } }
  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-click]')) return
    const target = e.target as HTMLElement
    if (target.classList.contains('split-handle')) drag.current = { mode: 'split', sx: 0, sy: 0 }
    else if (lab.tool === 'region') { const q = pct(e); drag.current = { mode: 'region', sx: q.x, sy: q.y }; setLab({ region: { x: q.x, y: q.y, w: 0, h: 0, done: false } }) }
    else if (lab.manual.zoom > 1) drag.current = { mode: 'pan', sx: e.clientX - lab.panX, sy: e.clientY - lab.panY }
    else return
    stage.current!.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'split') setLab({ split: pct(e).x })
    if (d.mode === 'pan') setLab({ panX: e.clientX - d.sx, panY: e.clientY - d.sy })
    if (d.mode === 'region') { const q = pct(e); setLab({ region: { x: Math.min(q.x, d.sx), y: Math.min(q.y, d.sy), w: Math.abs(q.x - d.sx), h: Math.abs(q.y - d.sy), done: false } }) }
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d?.mode === 'region') {
      const r = useUI.getState().lab.region
      if (!r || r.w < 2 || r.h < 2) setLab({ region: null })
      else run(lab.opts.super ? L('Đang tăng độ phân giải', 'Upscaling') : L('Đang phóng to', 'Zooming'), 900, () => setLab(l => ({ region: l.region ? { ...l.region, done: true } : null })))
    }
  }

  const upload = async (f: File) => {
    const fd = new FormData()
    fd.append('file', f)
    try { const s = await api<Snapshot>(`/api/cases/${caseId}/snapshots/upload`, { body: fd }); await qc.invalidateQueries({ queryKey: ['snapshots'] }); setLab({ snapId: s.id, ...labDefaults() }) }
    catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  const body = () => ({ ...p, layers: lab.layers, redact: lab.redact, ai: on })
  const exportLabels = async () => {
    if (!snap) return
    try { const r = await api<{ id: string; file_name: string; sha256: string; url: string }>(`/api/snapshots/${snap.id}/export`, { body: body() }); openModal('exported', r) }
    catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  const insert = async () => {
    if (!snap) return
    try { await api(`/api/snapshots/${snap.id}/to-report`, { body: body() }); qc.invalidateQueries({ queryKey: ['snapshots'] }); toast(L(`Đã chèn ảnh vào báo cáo ${c?.code || ''}`, `Image inserted into ${c?.code || ''} report`), 'success') }
    catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }

  if (!snaps.length) return <div className="h-full p-6"><Empty title={L('Chưa có khung hình nào', 'No frames yet')} hint={L('Bấm Chụp (phím S) khi xem video, hoặc mở một ảnh từ máy.', 'Press Snapshot (S) while watching, or open an image from your computer.')}>
    {editable && <label className="btn btn-quiet mt-4 cursor-pointer"><Icon name="image" />{t('openImg')}<input type="file" accept="image/*" className="sr-only" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} /></label>}</Empty></div>
  if (!snap) return null

  const ann = snap.annotations || []
  const counts: Record<string, number> = {}
  ann.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1 })
  const ocr = ann.find(a => a.type === 'plate' && a.id === lab.ocr)
  const sugg = ann.some(a => a.type === 'plate' && a.c < 80) ? 'plate' : ann.some(a => a.type === 'face') ? 'face' : null
  const tf = `translate(${lab.panX}px, ${lab.panY}px) scale(${lab.manual.zoom})`
  const split = on ? lab.split : 100
  const src = media(snap.url)
  const sr = stage.current?.getBoundingClientRect()
  const r = lab.region
  const insetW = sr ? Math.min(300, sr.width * 0.45) : 240
  const insetH = sr && r ? clamp((insetW * (r.h * sr.height)) / Math.max(1, r.w * sr.width), 80, sr.height * 0.7) : 160
  const insetP = lab.opts.super ? { ...p, k: p.k + 1.5, c: p.c * 1.08 } : p
  const names: Record<string, string> = { person: L('Người', 'People'), vehicle: L('Xe', 'Vehicles'), plate: L('Biển số', 'Plates'), face: L('Khuôn mặt', 'Faces') }

  const annEl = (a: Annotation, i: number) => {
    const pos = { left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }
    if (lab.redact && (a.type === 'face' || a.type === 'plate')) return <div key={i} className="redact" style={pos} />
    if (!lab.layers[a.type]) return null
    const lbl = a.type === 'person' ? `${a.track_id} · ${a.c}%` : a.type === 'vehicle' ? `${L('Xe', 'Car')} · ${a.c}%` : a.type === 'face' ? L('Mặt', 'Face') : L('Biển số · nhấn để đọc', 'Plate · tap to read')
    const click = a.type === 'plate' ? () => setLab({ ocr: a.id, layers: { ...lab.layers, plate: true } }) : undefined
    return <div key={i} data-click={click ? '1' : undefined} className={`det ${a.type === 'plate' ? 'det-plate' : ''} ${a.type === 'face' ? 'det-face' : ''} ${lab.ocr === a.id && a.type === 'plate' ? 'det-focus' : ''} ${click ? 'det-click' : ''}`} style={pos} onClick={click}><span className="det-label">{lbl}</span></div>
  }

  return (
    <div className="h-full flex">
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id="fSharpI"><feConvolveMatrix order="3" kernelMatrix={`0 ${-p.k} 0 ${-p.k} ${1 + 4 * p.k} ${-p.k} 0 ${-p.k} 0`} preserveAlpha="true" /></filter>
        <filter id="fEdge"><feConvolveMatrix order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" /></filter>
      </svg>
      <div className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
            {(['person', 'vehicle', 'plate', 'face'] as const).map(k => <button key={k} className="chip" aria-pressed={lab.layers[k]} onClick={() => setLab({ layers: { ...lab.layers, [k]: !lab.layers[k] } })}>{names[k]}<span className="tabular opacity-70">{counts[k] || 0}</span></button>)}
            {!ann.length && <span className="text-xs text-muted self-center">{t('noAnn')}</span>}
          </div>
          <div className="ml-auto flex gap-2">
            <button className={`btn btn-quiet ${lab.tool === 'region' ? '!bg-inverse !text-inverse-fg' : ''}`} aria-pressed={lab.tool === 'region'} data-tip={t('tipRegion')}
              onClick={() => setLab(l => ({ tool: l.tool === 'region' ? null : 'region', manual: { ...l.manual, zoom: 1 }, panX: 0, panY: 0 }))}><Icon name="scan" /><span className="hidden sm:inline">{t('region')}</span></button>
            {editable && <label className="btn btn-quiet cursor-pointer" data-tip={t('tipOpenImg')}><Icon name="image" /><span className="hidden sm:inline">{t('openImg')}</span>
              <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} /></label>}
            <button className="btn btn-quiet xl:hidden" onClick={() => set({ labPanelOpen: true })}><Icon name="wand" className="text-accent" />AI</button>
          </div>
        </div>

        <div ref={stage} className="relative w-full aspect-video max-h-[66vh] rounded-lg overflow-hidden bg-black select-none touch-none"
          style={{ cursor: lab.tool === 'region' ? 'crosshair' : lab.manual.zoom > 1 ? 'grab' : 'default' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <div className="absolute inset-0 origin-center" style={{ transform: tf }}><img src={src} className="absolute inset-0 w-full h-full object-cover" draggable={false} alt={L('Ảnh gốc', 'Original')} /></div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            <div className="absolute inset-0 origin-center" style={{ transform: tf }}><img src={src} className="absolute inset-0 w-full h-full object-cover" draggable={false} style={{ filter: on ? labCss(p) : 'none' }} alt={t('enhancedLabel')} /></div>
          </div>
          <div className="absolute inset-0 origin-center pointer-events-none" style={{ transform: tf }}><div className="absolute inset-0 [&_.det-click]:pointer-events-auto">{ann.map(annEl)}</div></div>
          {on && <>
            <span className="absolute top-4 left-4 h-6 px-2 rounded bg-black/60 text-white text-[11px] flex items-center pointer-events-none">{t('original')}</span>
            <span className="absolute top-4 right-4 h-6 px-2 rounded bg-accent text-accent-fg text-[11px] flex items-center pointer-events-none">{t('enhancedLabel')}</span>
            <div className="split-handle" style={{ left: `${lab.split}%` }} tabIndex={0} role="slider" aria-label={L('So sánh gốc và AI', 'Compare original and AI')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(lab.split)}
              onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setLab({ split: clamp(lab.split + (e.key === 'ArrowLeft' ? -5 : 5), 0, 100) }) } }} />
          </>}
          {r && <div className="absolute border-2 border-dashed border-white pointer-events-none" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,.35)' }} />}
          {r?.done && (
            <div className="absolute top-4 right-4 rounded-md overflow-hidden bg-black border-2 border-white shadow-xl" style={{ width: insetW, height: insetH }}>
              <img src={src} className="absolute max-w-none object-cover" alt="" style={{ width: `${(100 / r.w) * 100}%`, height: `${(100 / r.h) * 100}%`, left: `${(-r.x / r.w) * 100}%`, top: `${(-r.y / r.h) * 100}%`, filter: labCss(insetP) }} />
              <span className="absolute top-2 left-2 h-5 px-2 rounded bg-accent text-accent-fg text-[10px] flex items-center">{lab.opts.super ? t('superTitle') : L('Phóng to vùng chọn', 'Zoomed selection')}</span>
              <button data-click="1" className="absolute top-1 right-1 w-7 h-7 rounded bg-black/60 text-white grid place-items-center cursor-pointer" aria-label={t('close')} onClick={() => setLab({ region: null })}><Icon name="x" className="text-xs" /></button>
            </div>
          )}
          {ocr && (
            <div data-click="1" className="absolute left-4 bottom-4 w-[min(300px,calc(100%-32px))] panel p-4 shadow-xl fade-in">
              <div className="flex items-start justify-between"><p className="label">{t('ocrTitle')}</p><button className="icon-btn-sm -mt-2 -mr-2" aria-label={t('close')} onClick={() => setLab({ ocr: null })}><Icon name="x" className="text-xs" /></button></div>
              <p className="font-mono text-2xl font-semibold tracking-wide mt-1">{ocr.plate}</p>
              <div className="flex items-center gap-2 mt-2"><div className="flex-1 h-1 rounded-full bg-line overflow-hidden"><div className={`h-full ${ocr.c >= 70 ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${ocr.c}%` }} /></div><span className="text-xs text-muted tabular">{ocr.c}%</span></div>
              <p className="text-xs text-muted mt-4">{t('ocrAlt')}</p>
              <ul className="mt-1 text-sm space-y-1">{(ocr.alts || []).map(a => <li key={a.text} className="flex justify-between"><span className="font-mono">{a.text}</span><span className="text-muted tabular text-xs">{a.confidence}%</span></li>)}</ul>
              {ocr.c < 70 && <p className="text-xs text-warn mt-4"><Icon name="triangle-alert" className="mr-1" />{L('Độ tin cậy thấp. Thử tình huống "Đọc biển số" rồi đọc lại.', 'Low confidence. Try the "Read plate" scenario, then read again.')}</p>}
              <div className="flex gap-2 mt-4">
                <button className="btn btn-primary h-8 text-xs flex-1" onClick={() => set({ aiOpen: true, aiPrefill: L(`Biển số ${ocr.plate} xuất hiện ở đâu?`, `Where does plate ${ocr.plate} appear?`) })}>{t('ocrSearch')}</button>
                <button className="btn btn-quiet h-8 text-xs" onClick={() => { copyText(ocr.plate!); toast(L(`Đã sao chép ${ocr.plate}`, `Copied ${ocr.plate}`), 'success') }}>{t('copy')}</button>
              </div>
            </div>
          )}
          {busy && <div className="absolute top-4 left-1/2 -translate-x-1/2 h-8 px-4 rounded-full bg-surface text-fg text-xs flex items-center gap-2 shadow"><Icon name="loader" className="text-accent" />{busy}</div>}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-muted">{t('original')}</span>
          <input type="range" className="rng flex-1" min={0} max={100} value={lab.split} disabled={!on} style={{ ['--p' as any]: `${lab.split}%` }} aria-label={L('So sánh gốc và AI', 'Compare original and AI')} onChange={e => setLab({ split: +e.target.value })} />
          <span className="text-xs text-muted">AI</span>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2"><h2 className="text-sm font-semibold">{t('frames')}</h2><span className="text-xs text-muted">{t('framesHint')}</span></div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {snaps.map((x, i) => (
              <div key={x.id} role="button" tabIndex={0} className="group relative w-48 shrink-0 cursor-pointer focus-visible:outline-none" aria-label={x.caption}
                onClick={() => setLab({ snapId: x.id, ...labDefaults(), tool: null })} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setLab({ snapId: x.id, ...labDefaults() })}>
                <span className={`block relative aspect-video rounded-md overflow-hidden bg-subtle ring-1 ${snap.id === x.id ? 'ring-2 ring-fg' : 'ring-line group-hover:ring-line2'} group-focus-visible:ring-2 group-focus-visible:ring-accent`}>
                  <img src={media(x.url)} className="w-full h-full object-cover" alt="" loading="lazy" />
                  {i === 0 && x.video_id && <span className="absolute top-1 left-1 h-5 px-2 rounded bg-surface text-fg text-[10px] font-medium flex items-center">{t('best')}</span>}
                  {x.in_report && <span className="absolute bottom-1 left-1 h-5 px-1.5 rounded bg-accent text-accent-fg text-[10px] flex items-center"><Icon name="file-text" className="text-[10px]" /></span>}
                  {editable && <button className="absolute top-1 right-1 w-6 h-6 rounded bg-black/60 text-white opacity-100 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 grid place-items-center cursor-pointer" aria-label={t('delete')}
                    onClick={async e => { e.stopPropagation(); await api(`/api/snapshots/${x.id}`, { method: 'DELETE' }); qc.invalidateQueries({ queryKey: ['snapshots'] }) }}><Icon name="x" className="text-[10px]" /></button>}
                </span>
                <span className="block text-xs truncate mt-1">{lang === 'vi' ? x.caption : x.caption.replace('người', 'people').replace('xe', 'vehicles').replace('biển số rõ', 'plate legible').replace('biển số mờ', 'plate blurry').replace('Ảnh tải lên', 'Uploaded image')}</span>
                <span className="block text-[11px] text-muted font-mono truncate">{x.video_id ? `${x.evidence_id} · ${x.camera_id} ${fmt(x.t)}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <aside id="imgPanel" aria-label={L('Cải thiện ảnh bằng AI', 'AI image enhancement')}
        className={`fixed inset-y-0 right-0 z-50 w-[min(320px,88vw)] ${labPanelOpen ? 'translate-x-0' : 'translate-x-full'} xl:static xl:translate-x-0 xl:z-auto xl:w-[320px] shrink-0 flex flex-col bg-surface border-l border-line transition-transform duration-300`}>
        <div className="flex items-center justify-between h-12 px-4 border-b border-line shrink-0">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Icon name="wand" className="text-accent" />{t('aiEnhance')}</h2>
          <button className="icon-btn xl:hidden" aria-label={t('close')} onClick={() => set({ labPanelOpen: false })}><Icon name="x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <button className="btn btn-primary w-full h-10" disabled={!!busy} onClick={() => run(t('oneTouchBusy'), 1200, () => { setLab(l => ({ oneTouch: true, split: 50, opts: { ...l.opts, denoise: true } })); toast(L('Đã cải thiện: tăng sáng, tăng tương phản, làm nét, khử nhiễu', 'Enhanced: brightened, more contrast, sharpened, denoised'), 'success') })}>
            {busy === t('oneTouchBusy') ? <Icon name="loader" /> : <Icon name="wand" />}{t('oneTouch')}</button>
          <div><p className="label mb-2">{t('scenario')}</p><div className="flex flex-wrap gap-2">
            {Object.entries(SCENES).map(([k, sc]) => <button key={k} className="chip" aria-pressed={lab.scene === k} onClick={() => setLab({ scene: lab.scene === k ? null : k })}>{t(sc.key)}{sugg === k && <span className={`text-[10px] ${lab.scene === k ? 'opacity-70' : 'text-accent'}`}>{t('suggested')}</span>}</button>)}
          </div></div>
          <div className="divide-y divide-line">
            <Switch label={t('oSuper')} checked={lab.opts.super} onChange={v => setLab({ opts: { ...lab.opts, super: v } })} />
            <Switch label={t('oDeblur')} checked={lab.opts.deblur} onChange={v => setLab({ opts: { ...lab.opts, deblur: v } })} />
            <Switch label={t('oDenoise')} checked={lab.opts.denoise} onChange={v => setLab({ opts: { ...lab.opts, denoise: v } })} />
            <Switch label={t('redact')} checked={lab.redact} onChange={v => setLab({ redact: v })} />
          </div>
          <details className="group">
            <summary className="flex items-center justify-between cursor-pointer text-sm text-muted hover:text-fg list-none">{t('advanced')}<Icon name="chevron-down" className="text-[10px] transition-transform group-open:rotate-180" /></summary>
            <div className="space-y-4 mt-4">
              {MANUAL.map(a => {
                const val = lab.manual[a.k]
                return <div key={a.k}><div className="flex justify-between text-xs mb-2"><label htmlFor={`rng-${a.k}`}>{t(('key' in a ? a.key : a.k) as any)}</label><output className="font-mono text-muted tabular">{a.f(val)}</output></div>
                  <input id={`rng-${a.k}`} type="range" className="rng" min={a.min} max={a.max} step={a.step} value={val} style={{ ['--p' as any]: `${((val - a.min) / (a.max - a.min)) * 100}%` }}
                    onChange={e => setLab(l => ({ manual: { ...l.manual, [a.k]: +e.target.value }, ...(a.k === 'zoom' && +e.target.value === 1 ? { panX: 0, panY: 0 } : {}) }))} /></div>
              })}
              <div className="divide-y divide-line">
                {(['gray', 'invert', 'edge'] as const).map(k => <Switch key={k} label={t(k)} checked={lab.manual[k]} onChange={v => setLab(l => ({ manual: { ...l.manual, [k]: v } }))} />)}
              </div>
            </div>
          </details>
          <button className="text-xs text-muted hover:text-fg underline underline-offset-2 cursor-pointer" onClick={() => setLab({ ...labDefaults() })}>{t('resetAi')}</button>
        </div>
        <div className="p-4 border-t border-line grid grid-cols-2 gap-2 shrink-0">
          <button className="btn btn-quiet text-xs col-span-2" onClick={() => set({ aiOpen: true, labPanelOpen: false, aiPrefill: L('Mô tả ảnh này', 'Describe this image') })}><Icon name="message" />{t('askImage')}</button>
          {editable && <button className="btn btn-quiet text-xs" onClick={insert}>{t('toReport')}</button>}
          <a className="btn btn-quiet text-xs" href={media(snap.url)} download={`VMA_goc_${snap.id.slice(0, 8)}.jpg`}>{t('dlOrig')}</a>
          {editable && <button className="btn btn-primary text-xs col-span-2" onClick={exportLabels}><Icon name="download" />{t('dlAi')}</button>}
        </div>
      </aside>
      {labPanelOpen && <div className="fixed inset-0 z-40 bg-black/40 xl:hidden" onClick={() => set({ labPanelOpen: false })} />}
    </div>
  )
}

