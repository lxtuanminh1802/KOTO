import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { attrOf, boxAt, COLORS, labelOf } from '../lib/domain'
import { absAt, clamp, dmy, fmt, hms, shortHash } from '../lib/format'
import { useT } from '../lib/i18n'
import { player } from '../lib/player'
import { can } from '../lib/perm'
import { EMPTY, qc, refreshCase, useCases, useDetections, useTags, useVideos } from '../lib/queries'
import { toast, useUI } from '../lib/store'
import type { Detection, Video } from '../lib/types'
import { Icon, MenuButton, Switch, VideoTag } from '../components/ui'
import { isLive } from '../components/Sidebar'

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]
const VENH_OPTS: [keyof ReturnType<typeof useUI.getState>['venh']['opts'], 'vDenoise' | 'vLowlight' | 'vStab' | 'vSuper' | 'vDeblur'][] = [
  ['denoise', 'vDenoise'], ['lowlight', 'vLowlight'], ['stab', 'vStab'], ['super', 'vSuper'], ['deblur', 'vDeblur'],
]

function venhFilter(o: ReturnType<typeof useUI.getState>['venh']['opts']) {
  let b = 100, c = 100, s = 100, k = 0
  if (o.lowlight) { b += 30; c += 12 }
  if (o.denoise) { s -= 8; c += 4 }
  if (o.super) k += 0.9
  if (o.deblur) k += 0.7
  return { css: `${k ? 'url(#fSharpV) ' : ''}brightness(${b}%) contrast(${c}%) saturate(${s}%)`, k }
}

export default function FootageView() {
  const { t: tr, L, lang } = useT()
  const ui = useUI()
  const { videoId, caseId, set } = ui
  const { data: videos = EMPTY } = useVideos()
  const { data: cases = EMPTY } = useCases()
  const v = videos.find(x => x.id === videoId && isLive(x)) || null
  const root = v?.parent_id ? videos.find(x => x.id === v.parent_id) || null : v
  const c = cases.find(x => x.id === v?.case_id) || null
  const { data: detData } = useDetections(v?.id || null, !!v && (v.state === 'ANALYZED' || v.alerts > 0))
  const { data: tags = EMPTY } = useTags(caseId)
  const dets = detData?.detections || []
  const zones = detData?.zones || []

  // Pick a default video for the active case (UR-CASE-06).
  useEffect(() => {
    if (!v && videos.length) {
      const first = videos.find(x => x.case_id === caseId && !x.parent_id && isLive(x)) || null
      if (first) set({ videoId: first.id })
    }
  }, [v, videos, caseId, set])

  if (!v) return <div className="h-full grid place-items-center text-sm text-muted p-6">{tr('noVideoSel')}</div>
  return <Footage key={v.id} v={v} root={root || v} caseLead={c} dets={dets} zones={zones} tags={tags.filter(x => x.video_id === v.id)} tr={tr} L={L} lang={lang} />
}

function Footage({ v, root, caseLead, dets, zones, tags, tr, L, lang }: {
  v: Video; root: Video; caseLead: any; dets: Detection[]; zones: { id: string; name: string; polygon: number[][] }[]; tags: { id: string; t: number; color: string; note: string }[]
  tr: ReturnType<typeof useT>['t']; L: ReturnType<typeof useT>['L']; lang: 'vi' | 'en'
}) {
  const { playing, speed, zoom, inT, outT, focusDet, evKind, overlayOff, venh, pendingSeek, set } = useUI()
  const vid = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(0)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const offset = v.parent_id ? v.clip_start || 0 : 0
  const dur = v.duration || 1
  const ready = v.state === 'ANALYZED'
  const src = root.has_file ? media(`/api/media/videos/${root.id}/stream`) : ''
  const lastSync = useRef(0)

  const syncStore = useCallback((x: number, force = false) => {
    const now = performance.now()
    if (force || now - lastSync.current > 250) {
      lastSync.current = now
      useUI.setState({ t: x })
    }
  }, [])

  const seek = useCallback((x: number) => {
    const nt = clamp(x, 0, dur)
    setT(nt)
    syncStore(nt, true)
    if (vid.current) vid.current.currentTime = nt + offset
  }, [dur, offset, syncStore])

  // Fit the frame to the stage keeping the video's aspect ratio, so % boxes land on pixels.
  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ar = (v.width && v.height ? v.width / v.height : 16 / 9)
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth, H = el.clientHeight
      const w = Math.min(W, H * ar)
      setFit({ w, h: w / ar })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [v.width, v.height])

  // Pending seek from results, tags, alerts, assistant.
  useEffect(() => {
    if (pendingSeek && pendingSeek.videoId === v.id) {
      const go = () => { seek(pendingSeek.t); set({ pendingSeek: null }) }
      if (vid.current && vid.current.readyState >= 1) go()
      else vid.current?.addEventListener('loadedmetadata', go, { once: true })
    }
  }, [pendingSeek, v.id, seek, set])

  useEffect(() => {
    const el = vid.current
    if (!el) return
    const onMeta = () => { if (el.currentTime < offset) el.currentTime = offset }
    el.addEventListener('loadedmetadata', onMeta)
    return () => el.removeEventListener('loadedmetadata', onMeta)
  }, [offset])

  // Playback loop: read the element clock, stop at Out or the end of the clip (UR-VID-01, UR-CLIP-01).
  useEffect(() => {
    const el = vid.current
    if (!el) return
    el.playbackRate = speed
    if (!playing) { el.pause(); syncStore(el.currentTime - offset, true); return }
    const end = outT ?? dur
    if (el.currentTime - offset >= end - 0.05) el.currentTime = (inT ?? 0) + offset
    el.play().catch(() => set({ playing: false }))
    let raf = 0
    const loop = () => {
      const x = el.currentTime - offset
      if (x >= end) { el.pause(); el.currentTime = end + offset; setT(end); set({ playing: false }); return }
      setT(x)
      syncStore(x)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, outT, inT, dur, offset, set, syncStore])

  useEffect(() => () => { useUI.setState({ playing: false }) }, [])

  // Enhanced half of the split view, drawn from the same element.
  const f = venhFilter(venh.opts)
  useEffect(() => {
    if (!venh.on) return
    let raf = 0
    const draw = () => {
      const cv = canvas.current, el = vid.current
      if (cv && el && el.videoWidth) {
        if (cv.width !== el.videoWidth) { cv.width = el.videoWidth; cv.height = el.videoHeight }
        cv.getContext('2d')!.drawImage(el, 0, 0)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [venh.on])

  const active = useMemo(() => dets.filter(d => (ready || d.alerted) && t >= d.t_in && t <= d.t_out), [dets, ready, t])

  const doClip = async () => {
    if (inT == null || outT == null) return toast(L('Đặt điểm In và Out trước (phím I, O)', 'Set In and Out first (keys I, O)'), 'warn')
    if (outT - inT < 1) return toast(L('Đoạn cắt phải dài ít nhất 1 giây', 'A clip must be at least 1 second long'), 'warn')
    try {
      const clip = await api<Video>(`/api/videos/${v.id}/clips`, { body: { start: inT, end: outT } })
      set({ inT: null, outT: null })
      refreshCase()
      toast(L(`Đã tạo ${clip.name}`, `Created ${clip.name}`), 'success')
    } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  const doSnapshot = async () => {
    try {
      await api(`/api/videos/${v.id}/snapshot`, { body: { t } })
      qc.invalidateQueries({ queryKey: ['snapshots'] })
      toast(L(`Đã chụp khung hình ${fmt(t)}`, `Captured frame at ${fmt(t)}`), 'success')
    } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  const doBookmark = async () => {
    try {
      await api('/api/tags/bookmark', { body: { video_id: v.id, t } })
      qc.invalidateQueries({ queryKey: ['tags'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      toast(L(`Đã đánh dấu tại ${fmt(t)}`, `Bookmarked at ${fmt(t)}`), 'success')
    } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
  }
  const markIn = () => { const cur = useUI.getState(); set({ inT: t, outT: cur.outT != null && cur.outT <= t ? null : cur.outT }); toast(L(`Điểm vào ${fmt(t)}`, `In point ${fmt(t)}`)) }
  const markOut = () => { const cur = useUI.getState(); set({ outT: t, inT: cur.inT != null && cur.inT >= t ? null : cur.inT }); toast(L(`Điểm ra ${fmt(t)}`, `Out point ${fmt(t)}`)) }
  const canEdit = can('video.edit', caseLead)
  const canTag = can('tag', caseLead)

  useEffect(() => {
    player.current = {
      toggle: () => set({ playing: !useUI.getState().playing }),
      seek, seekRel: d => seek(t + d), markIn: () => canEdit && markIn(), markOut: () => canEdit && markOut(),
      bookmark: () => canTag && doBookmark(), snapshot: () => canEdit && doSnapshot(), pause: () => set({ playing: false }),
    }
    return () => { player.current = null }
  })

  const base = root.name.replace(/\.\w+$/, '')
  const hint = inT == null ? L('Muốn cắt một đoạn? Tua tới điểm bắt đầu rồi bấm In (phím I).', 'Want a clip? Go to the start point and press In (I).')
    : outT == null ? L('Tua tới điểm kết thúc rồi bấm Out (phím O).', 'Go to the end point and press Out (O).')
    : L(`Bấm Cắt đoạn để tạo ${base}_Cut_${root.cut_seq + 1}, nằm dưới video gốc.`, `Press Cut clip to create ${base}_Cut_${root.cut_seq + 1} under the original.`)
  const abs0 = absAt(v.recorded_start, 0)
  const osdTime = absAt(v.recorded_start, t)
  const overlay = !overlayOff[v.id]

  // Timeline density (UR-VID-04)
  const bins = Math.max(10, Math.min(60, Math.ceil(dur / 2)))
  const bw = dur / bins
  const counts = Array.from({ length: bins }, (_, i) => ready ? dets.filter(d => d.t_in < (i + 1) * bw && d.t_out >= i * bw).length : 0)
  const max = Math.max(1, ...counts)
  const step = dur > 90 ? 15 : dur > 40 ? 10 : 5
  const ticks: number[] = []
  for (let s = 0; s <= dur; s += step) ticks.push(s)

  const tl = useRef<HTMLDivElement>(null)
  const scrub = (e: React.PointerEvent) => {
    const el = tl.current!
    const r = el.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => seek(((ev.clientX - r.left) / r.width) * dur)
    move(e.nativeEvent)
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const splitDrag = (e: React.PointerEvent) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const r = el.parentElement!.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => set(s => ({ venh: { ...s.venh, split: clamp(((ev.clientX - r.left) / r.width) * 100, 0, 100) } }))
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  let list = [...dets].filter(d => ready || d.alerted).sort((a, b) => a.t_in - b.t_in)
  if (evKind !== 'all') list = list.filter(d => d.kind === evKind)
  const analysisLabel = lang === 'vi' ? v.analysis.label_vi : v.analysis.label_en

  return (
    <div className="h-full flex flex-col xl:flex-row gap-6 p-4 sm:p-6 overflow-y-auto xl:overflow-hidden">
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id="fSharpV"><feConvolveMatrix order="3" kernelMatrix={`0 ${-f.k} 0 ${-f.k} ${1 + 4 * f.k} ${-f.k} 0 ${-f.k} 0`} preserveAlpha="true" /></filter>
      </svg>
      <div className="flex-1 min-w-0 flex flex-col gap-4 xl:min-h-0">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">{v.name}</h1>
            <p className="text-xs text-muted mt-1 leading-6">
              <VideoTag clip={!!v.parent_id} />{' '}
              {v.parent_id && <>{L('từ', 'from')} <button className="font-mono underline underline-offset-2 hover:text-fg cursor-pointer" onClick={() => set({ videoId: root.id, t: 0, inT: null, outT: null, pendingSeek: { videoId: root.id, t: offset } })}>{root.evidence_id}</button>{' '}
                <span className="font-mono">{fmt(v.clip_start || 0)}–{fmt(v.clip_end || 0)}</span> · </>}
              <span className="font-mono">{v.evidence_id}</span> · {v.camera_id}{v.camera?.name ? `, ${v.camera.name}` : ''} · <span className="font-mono">{dmy(abs0)} {hms(abs0)}–{hms(absAt(v.recorded_start, dur))}</span>
              {v.analysis.engine && <> · {analysisLabel}{v.analysis.engine === 'simulated' ? <span className="text-muted"> ({L('AI mô phỏng', 'simulated AI')})</span> : null}</>}
              {v.sha256 && <> · <span className="font-mono" title={`SHA-256 ${v.sha256}`}>SHA-256 {shortHash(v.sha256)}</span>{' '}
                {v.integrity === 'MISMATCH' ? <span className="inline-flex items-center gap-1 text-danger font-semibold"><Icon name="shield-alert" className="text-xs" />{L('Lệch mã băm', 'Hash mismatch')}</span>
                  : <span className="inline-flex items-center gap-1 text-ok"><Icon name="shield-check" className="text-xs" />{L('Toàn vẹn', 'Verified')}</span>}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted inline-flex items-center gap-1">{ready ? `${dets.length} ${tr('objects')}` : v.state === 'ANALYZING' ? <><Icon name="loader" />{tr('analyzing')} {Math.floor(v.progress)}%</> : v.state === 'QUEUED' ? L('Chờ phân tích', 'Queued') : v.state}</span>
            <button id="venhBtn" className={`btn btn-quiet ${venh.on ? 'border-accent text-accent' : ''}`} aria-pressed={venh.on} data-tip={tr('tipEnhance')} onClick={() => set(s => ({ venh: { ...s.venh, on: !s.venh.on, split: 50 } }))}>
              <Icon name="wand" />{tr('aiEnhance')}</button>
          </div>
        </div>

        {venh.on && (
          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {VENH_OPTS.map(([k, lb]) => <div key={k} className="w-full sm:w-auto"><Switch label={tr(lb)} checked={venh.opts[k]} onChange={x => set(s => ({ venh: { ...s.venh, opts: { ...s.venh.opts, [k]: x } } }))} /></div>)}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-line text-xs text-muted">
              <span className="inline-flex items-center gap-1"><Icon name="check" className="text-ok" />{L('Xem trước trực tiếp trên trình phát', 'Live preview in the player')}</span>
              <span className="hidden sm:inline">{tr('venhHint')}</span>
              {canEdit && <button className="btn btn-quiet h-8 ml-auto" onClick={async () => {
                try { await api(`/api/videos/${v.id}/enhance`, { body: venh.opts }); toast(L('Đang xuất video đã cải thiện. Có thông báo khi xong.', 'Exporting the enhanced video. You will be notified when it is ready.')) }
                catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
              }}><Icon name="download" />{tr('venhExport')}</button>}
            </div>
          </div>
        )}

        <div id="player" ref={stage} className="relative w-full aspect-video xl:aspect-auto xl:flex-1 xl:min-h-[240px] rounded-lg overflow-hidden bg-black select-none">
          <div className="absolute left-1/2 top-1/2" style={{ width: fit.w, height: fit.h, transform: `translate(-50%,-50%) scale(${zoom})` }}>
            {src ? <video ref={vid} src={src} className="absolute inset-0 w-full h-full" muted playsInline preload="auto"
              style={{ filter: venh.on ? 'none' : undefined }} onClick={() => set({ playing: !playing })} /> : null}
            {venh.on && <canvas ref={canvas} className="absolute inset-0 w-full h-full pointer-events-none" style={{ filter: f.css, clipPath: `inset(0 0 0 ${venh.split}%)` }} />}
            {overlay && (
              <div className="absolute inset-0 pointer-events-none">
                {zones.length > 0 && (
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {zones.map(z => <polygon key={z.id} points={z.polygon.map(p => p.join(',')).join(' ')} fill="rgba(94,158,255,.12)" stroke="rgb(140,180,255)" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />)}
                  </svg>
                )}
                {active.map(d => {
                  const b = boxAt(d, t)
                  if (!b) return null
                  return (
                    <div key={d.id} className={`det ${focusDet === d.id ? 'det-focus' : d.watch_item_id ? 'det-watch' : ''}`} style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}>
                      <span className="det-label">{d.kind === 'vehicle' ? d.plate || d.track_id : d.track_id} · {d.confidence}%</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {!src && <div className="absolute inset-0 grid place-items-center text-white/70 text-sm">{v.state === 'UPLOADING' ? L('Video đang tải lên…', 'Video is uploading…') : L('Chưa có tệp video', 'No video file yet')}</div>}
          <div className="absolute top-4 left-4 h-6 px-2 rounded bg-black/60 text-white text-[11px] font-mono flex items-center pointer-events-none">{v.camera_id}  {dmy(osdTime)} {hms(osdTime)}</div>
          <div className="absolute top-4 right-4 h-6 px-2 rounded bg-black/60 text-white text-[11px] flex items-center pointer-events-none">{active.length} {tr('objects')}</div>
          {venh.on && <>
            <span className="absolute bottom-4 left-4 h-6 px-2 rounded bg-black/60 text-white text-[11px] flex items-center pointer-events-none">{tr('original')}</span>
            <span className="absolute bottom-4 right-4 h-6 px-2 rounded bg-accent text-accent-fg text-[11px] flex items-center pointer-events-none">AI</span>
            <div className="split-handle" style={{ left: `calc(50% - ${fit.w / 2}px + ${(venh.split / 100) * fit.w}px)` }} tabIndex={0} role="slider" aria-label={L('So sánh gốc và AI', 'Compare original and AI')}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(venh.split)} onPointerDown={splitDrag}
              onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); set(s => ({ venh: { ...s.venh, split: clamp(s.venh.split + (e.key === 'ArrowLeft' ? -5 : 5), 0, 100) } })) } }} />
          </>}
          {!playing && src && (
            <button className="absolute inset-0 m-auto w-12 h-12 rounded-md bg-black/55 text-white ring-1 ring-white/25 backdrop-blur-sm grid place-items-center text-lg transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
              aria-label={L('Phát', 'Play')} onClick={() => set({ playing: true })}><Icon name="play" fill className="ml-0.5" /></button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5">
            <button className="icon-btn text-fg" aria-label={L('Phát / tạm dừng', 'Play / pause')} data-tip={tr('tipPlay')} onClick={() => set({ playing: !playing })}><Icon name={playing ? 'pause' : 'play'} fill /></button>
            <button className="icon-btn" aria-label={L('Lùi 5 giây', 'Back 5 s')} data-tip={tr('tipBack')} onClick={() => seek(t - 5)}><Icon name="rotate-ccw" /></button>
            <button className="icon-btn" aria-label={L('Tiến 5 giây', 'Forward 5 s')} data-tip={tr('tipFwd')} onClick={() => seek(t + 5)}><Icon name="rotate-cw" /></button>
            <span className="font-mono text-xs tabular px-2">{fmt(t)} / {fmt(dur)}</span>
            <button className="btn btn-ghost h-8 px-2 text-xs font-mono" aria-label={L('Tốc độ phát', 'Playback speed')} data-tip={tr('tipSpeed')} onClick={() => set({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })}>{speed}×</button>
            <MenuButton className="icon-btn" label={tr('more')} tip={tr('tipMore')} items={[
              { icon: 'plus', label: `${L('Phóng to', 'Zoom in')} (${Math.round(zoom * 100)}%)`, onClick: () => set({ zoom: clamp(zoom + 0.25, 0.5, 3) }) },
              { icon: 'minus', label: L('Thu nhỏ', 'Zoom out'), onClick: () => set({ zoom: clamp(zoom - 0.25, 0.5, 3) }) },
              { icon: 'scan', label: L('Về 100%', 'Reset to 100%'), onClick: () => set({ zoom: 1 }) },
              { icon: overlay ? 'eye-off' : 'eye', label: tr(overlay ? 'overlayOn' : 'overlayOff'), onClick: () => set(s => ({ overlayOff: { ...s.overlayOff, [v.id]: overlay } })) },
            ]}><Icon name="ellipsis" /></MenuButton>
          </div>
          <div className="flex-1" />
          {canEdit && (
            <div id="cutGroup" className="flex items-center gap-1 p-1 rounded-lg border border-line bg-surface shadow-sm">
              <button className="btn btn-ghost h-7 px-2 text-xs font-semibold" data-tip={tr('tipIn')} onClick={markIn}>In</button>
              <span className="hidden sm:inline font-mono text-xs text-muted tabular px-1 whitespace-nowrap">{inT != null ? fmt(inT) : '--:--'} → {outT != null ? fmt(outT) : '--:--'}</span>
              <button className="btn btn-ghost h-7 px-2 text-xs font-semibold" data-tip={tr('tipOut')} onClick={markOut}>Out</button>
              <button className="btn btn-primary h-7 px-2.5 text-xs" disabled={inT == null || outT == null} data-tip={tr('tipCut')} onClick={doClip}><Icon name="scissors" />{tr('cut')}</button>
            </div>
          )}
          {canEdit && <button className="btn btn-quiet px-2.5" data-tip={tr('tipSnap')} aria-label={tr('snapBtn')} onClick={doSnapshot}><Icon name="camera" /><span className="hidden 2xl:inline">{tr('snapBtn')}</span></button>}
          {canTag && <button className="btn btn-quiet px-2.5" data-tip={tr('tipMark')} aria-label={tr('markBtn')} onClick={doBookmark}><Icon name="bookmark" /><span className="hidden 2xl:inline">{tr('markBtn')}</span></button>}
        </div>

        <div>
          <div ref={tl} className="relative h-16 cursor-pointer select-none touch-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" tabIndex={0} role="slider"
            aria-label={L('Vị trí phát', 'Playback position')} aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)} onPointerDown={scrub}
            onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 5)) } }}>
            {venh.on && <div className="absolute left-0 right-0 top-0 h-0.5 bg-accent" />}
            <div className="absolute inset-x-0 top-1 h-3">
              {tags.map(tg => <span key={tg.id} className="absolute -translate-x-1/2 top-0.5 w-2 h-2 rounded-full" style={{ left: `${(tg.t / dur) * 100}%`, background: COLORS[tg.color]?.hex }} title={tg.note} />)}
            </div>
            <div className="absolute inset-x-0 top-4 h-6 flex items-end gap-px">
              {counts.map((n, i) => <span key={i} className="flex-1 rounded-[1px] bg-fg" style={{ height: `${Math.max(8, (n / max) * 100)}%`, opacity: n ? 0.12 + (n / max) * 0.38 : 0.06 }} />)}
            </div>
            {(inT != null || outT != null) && <div className="absolute top-0 bottom-6 bg-accent/10 border-x border-accent" style={{ left: `${((inT ?? 0) / dur) * 100}%`, width: `${Math.max(0.3, (((outT ?? dur) - (inT ?? 0)) / dur) * 100)}%` }} />}
            <div className="absolute inset-x-0 bottom-0 h-6 border-t border-line">
              {ticks.map(s => <span key={s}><span className="absolute top-0 w-px h-1.5 bg-line2" style={{ left: `${(s / dur) * 100}%` }} /><span className="absolute top-2 -translate-x-1/2 text-[10px] font-mono text-muted" style={{ left: `${(s / dur) * 100}%` }}>{fmt(s)}</span></span>)}
            </div>
            <div className="absolute top-0 bottom-0 w-px bg-fg pointer-events-none" style={{ left: `${(t / dur) * 100}%` }}><span className="absolute -top-1 -left-1 w-2.5 h-2.5 rounded-full bg-fg" /></div>
          </div>
          <p className="flex items-center gap-2 mt-2 text-xs text-muted"><Icon name="lightbulb" className="text-accent" /><span>{canEdit ? hint : L('Bạn có quyền xem; cắt đoạn và chụp khung cần quyền điều tra viên hoặc giám định viên.', 'View only; cutting and snapshots need investigator or expert rights.')}</span>
            <button className="ml-auto shrink-0 hover:text-fg hover:underline underline-offset-2 cursor-pointer" onClick={() => useUI.getState().set({ modal: { kind: 'shortcuts' } })}>{tr('shortcuts')}</button></p>
        </div>
      </div>

      <aside className="xl:w-[320px] shrink-0 flex flex-col min-h-[320px] xl:min-h-0" aria-label={tr('events')}>
        <div className="flex items-center justify-between"><h2 className="text-sm font-bold">{tr('events')}</h2><span className="text-xs text-muted tabular">{ready ? list.length : ''}</span></div>
        <p className="text-xs text-muted mt-0.5">{tr('eventsHint')}</p>
        <div className="tabs mt-2" role="tablist">
          {(['all', 'person', 'vehicle'] as const).map(k => <button key={k} role="tab" aria-selected={evKind === k} onClick={() => set({ evKind: k })}>{tr(k === 'all' ? 'all' : k === 'person' ? 'people' : 'vehicles')}</button>)}
        </div>
        <ul className="flex-1 overflow-y-auto py-2">
          {!ready && <>{[0, 1, 2, 3].map(i => <li key={i} className="h-12 my-2 rounded-md shimmer" />)}<li className="py-2 text-xs text-muted">{tr('waiting')}{v.alerts ? L(' · Đối tượng khớp danh sách theo dõi hiển thị ngay.', ' · Watchlist matches show right away.') : ''}</li></>}
          {list.map(d => {
            const live = t >= d.t_in && t <= d.t_out
            return (
              <li key={d.id}>
                <button className={`w-full flex items-center gap-3 px-2 py-2 rounded-md text-left hover:bg-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer ${focusDet === d.id ? 'bg-subtle' : ''}`}
                  onClick={() => { set({ focusDet: d.id, playing: false }); seek(d.t_in) }}>
                  <img src={media(d.kind === 'person' ? d.face_url || d.crop_url : d.crop_url)} className="w-9 h-9 rounded object-cover bg-black" alt="" loading="lazy" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium truncate">{labelOf(d, lang)}
                      {d.watch_item_id && <span className="tag bg-danger/10 text-danger"><Icon name="shield-alert" className="text-[10px]" />{L('Theo dõi', 'Watch')}</span>}</span>
                    <span className="block text-xs text-muted truncate">{attrOf(d, lang)}</span>
                  </span>
                  <span className="text-[11px] font-mono text-muted tabular">{fmt(d.t_in)}</span>
                  <span className={`w-1.5 h-1.5 rounded-full bg-accent transition-opacity ${live ? '' : 'opacity-0'}`} />
                </button>
              </li>
            )
          })}
          {ready && !list.length && <li className="py-4 text-sm text-muted">{tr('noEvents')}</li>}
        </ul>
      </aside>
    </div>
  )
}
