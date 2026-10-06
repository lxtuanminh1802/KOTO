import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { attrOf, boxAt, labelOf } from '../lib/domain'
import { hms } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, qc, useCameras, useTracks } from '../lib/queries'
import { gotoVideo, openModal, toast, useUI } from '../lib/store'
import type { Camera } from '../lib/types'
import { Icon, MenuButton } from '../components/ui'

/* Offline schematic of central Hanoi (approximate, not to scale) used when map tiles are unreachable (UR-MAP-01, Q11). */
const HN_WATER: [string, [number, number][]][] = [
  ['Hồ Hoàn Kiếm', [[21.0322, 105.852], [21.0316, 105.853], [21.0296, 105.8534], [21.027, 105.8537], [21.0256, 105.8534], [21.0252, 105.8526], [21.026, 105.8517], [21.0283, 105.8513], [21.0306, 105.8514]]],
  ['Hồ Thiền Quang', [[21.0201, 105.8441], [21.0199, 105.8468], [21.0179, 105.8471], [21.0172, 105.8446]]],
  ['Hồ Bảy Mẫu', [[21.016, 105.8418], [21.0152, 105.847], [21.0114, 105.8476], [21.0108, 105.8428], [21.0135, 105.8414]]],
  ['Sông Hồng', [[21.06, 105.8575], [21.04, 105.862], [21.02, 105.869], [21.0, 105.876], [20.975, 105.883], [20.975, 105.896], [21.0, 105.888], [21.02, 105.881], [21.04, 105.874], [21.06, 105.8695]]],
]
const HN_ROADS: [string, number, [number, number][]][] = [
  ['Tràng Tiền', 1, [[21.0247, 105.8536], [21.0244, 105.8575]]], ['Hàng Bài', 1, [[21.0247, 105.8536], [21.0215, 105.853], [21.0185, 105.8527]]],
  ['Đinh Tiên Hoàng', 0, [[21.033, 105.8527], [21.0296, 105.854], [21.0262, 105.8543], [21.0247, 105.8536]]], ['Lê Thái Tổ', 0, [[21.033, 105.8512], [21.0296, 105.8507], [21.0266, 105.851]]],
  ['Bà Triệu', 1, [[21.0266, 105.851], [21.0209, 105.8496], [21.012, 105.8494]]], ['Trần Hưng Đạo', 1, [[21.023, 105.8605], [21.0209, 105.8496], [21.0198, 105.842]]],
  ['Lê Duẩn', 1, [[21.0285, 105.8418], [21.0198, 105.842], [21.012, 105.8412], [21.0055, 105.841]]], ['Tràng Thi', 0, [[21.0283, 105.844], [21.0266, 105.851]]],
  ['Đại Cồ Việt', 0, [[21.009, 105.85], [21.008, 105.841]]], ['Trường Chinh', 1, [[21.0055, 105.841], [21.001, 105.832], [21.003, 105.8199]]],
  ['Tây Sơn', 1, [[21.003, 105.8199], [21.015, 105.8255], [21.0262, 105.8345]]], ['Nguyễn Trãi', 1, [[21.003, 105.8199], [20.996, 105.81], [20.99, 105.8]]],
  ['Đường Láng', 0, [[21.003, 105.8199], [21.013, 105.809], [21.023, 105.804]]], ['Trần Duy Hưng', 0, [[21.003, 105.8199], [21.007, 105.806], [21.01, 105.795]]],
  ['Giải Phóng', 0, [[21.0055, 105.841], [20.992, 105.841]]], ['Trần Khát Chân', 0, [[21.009, 105.85], [21.008, 105.862]]],
]
const HN_LABELS: [string, number, number, string?][] = [['Tràng Tiền', 21.0251, 105.856], ['Hàng Bài', 21.0215, 105.854], ['Bà Triệu', 21.016, 105.8505], ['Trần Hưng Đạo', 21.0225, 105.8575],
  ['Lê Duẩn', 21.015, 105.8402], ['Trường Chinh', 21.001, 105.832], ['Tây Sơn', 21.016, 105.8272], ['Nguyễn Trãi', 20.9945, 105.8085], ['Đường Láng', 21.014, 105.8095],
  ['Giải Phóng', 20.996, 105.842], ['Ngã Tư Sở', 21.0015, 105.8188], ['Hồ Gươm', 21.0288, 105.8526, 'water'], ['Sông Hồng', 21.015, 105.8755, 'water'], ['Hồ Bảy Mẫu', 21.0133, 105.8446, 'water']]

const BASEMAPS: Record<string, { vi: string; en: string; url?: (dark: boolean, key: string) => string }> = {
  streets: { vi: 'Đường phố', en: 'Streets', url: (d, k) => `https://api.maptiler.com/maps/${d ? 'streets-v2-dark' : 'streets-v2'}/256/{z}/{x}/{y}.png?key=${k}` },
  satellite: { vi: 'Vệ tinh', en: 'Satellite', url: (_d, k) => `https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}.jpg?key=${k}` },
  basic: { vi: 'Tối giản', en: 'Minimal', url: (d, k) => `https://api.maptiler.com/maps/${d ? 'dataviz-dark' : 'dataviz'}/256/{z}/{x}/{y}.png?key=${k}` },
  schematic: { vi: 'Sơ đồ ngoại tuyến', en: 'Offline schematic' },
}


export default function MapView() {
  const { t, L: Lx, lang } = useT()
  const { mapTab, selectedTrack, caseId, theme, set } = useUI()
  const { data: cams = EMPTY } = useCameras()
  const { data: tracks = EMPTY } = useTracks(caseId, mapTab)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{ tiles?: L.TileLayer; schematic?: L.LayerGroup; markers: Record<string, L.Marker>; route?: L.Polyline }>({ markers: {} })
  const [base, setBase] = useState('streets')
  const [blocked, setBlocked] = useState(false)
  const [addMode, setAddMode] = useState(false)
  const addRef = useRef(false)
  addRef.current = addMode
  const editable = can('camera')
  const sel = tracks.find(x => x.id === selectedTrack) || tracks[0]
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api<{ maptiler_key: string }>('/api/health'), staleTime: Infinity })
  const mapKey = health?.maptiler_key || ''

  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { attributionControl: true }).setView([21.018, 105.842], 14)
    m.attributionControl.setPrefix(false)
    m.createPane('base').style.zIndex = '250'
    const g = L.layerGroup()
    const opt = (cls: string) => ({ pane: 'base', className: cls, interactive: false })
    HN_WATER.forEach(([, pts]) => L.polygon(pts, opt('map-water')).addTo(g))
    HN_ROADS.forEach(([, major, pts]) => L.polyline(pts, opt('map-case' + (major ? ' major' : ''))).addTo(g))
    HN_ROADS.forEach(([, major, pts]) => L.polyline(pts, opt('map-road' + (major ? ' major' : ''))).addTo(g))
    HN_LABELS.forEach(([n, a, b, cls]) => L.marker([a, b], { pane: 'base', interactive: false, keyboard: false, icon: L.divIcon({ className: 'map-label ' + (cls || ''), html: `<span>${n}</span>`, iconSize: undefined }) }).addTo(g))
    layers.current.schematic = g
    m.on('click', e => {
      if (!addRef.current) return
      setAddMode(false)
      openModal('coord', { lat: e.latlng.lat.toFixed(6), lng: e.latlng.lng.toFixed(6) })
    })
    map.current = m
    setTimeout(() => map.current === m && m.invalidateSize(), 100)
    return () => { m.stop(); m.off(); m.remove(); map.current = null; layers.current = { markers: {} } }
  }, [])

  // Base layer, with automatic fallback to the schematic when tiles are blocked.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    if (l.tiles) { m.removeLayer(l.tiles); l.tiles = undefined }
    const bm = BASEMAPS[base]
    const note = Lx('Sơ đồ minh họa, không theo tỉ lệ', 'Schematic, not to scale')
    if (bm.url && mapKey) {
      l.schematic && m.removeLayer(l.schematic)
      const tiles = L.tileLayer(bm.url(theme === 'dark', mapKey), { attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a>', maxZoom: 20, crossOrigin: true }).addTo(m)
      let failed = 0, loaded = 0
      tiles.on('tileload', () => loaded++)
      tiles.on('tileerror', () => {
        if (++failed === 3 && !loaded) {
          setBlocked(true)
          setBase('schematic')
          toast(Lx('Không tải được ảnh bản đồ (mạng nội bộ hoặc bị chặn). Đang dùng sơ đồ ngoại tuyến.', 'Map tiles could not load (internal network or blocked). Using the offline schematic.'), 'warn')
        }
      })
      l.tiles = tiles
    } else {
      l.schematic?.addTo(m)
      m.attributionControl.addAttribution(note)
    }
    return () => { m.attributionControl.removeAttribution(note) }
  }, [base, theme, Lx, mapKey])

  // Camera pins (UR-MAP-02): drag to correct the position.
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    Object.values(l.markers).forEach(mk => m.removeLayer(mk))
    l.markers = {}
    cams.filter(c => c.lat != null && c.lng != null).forEach(c => {
      const icon = L.divIcon({ className: '', html: `<div class="cam-pin" data-cam="${c.id}"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] })
      const mk = L.marker([c.lat!, c.lng!], { icon, title: c.id, draggable: editable, autoPan: true }).addTo(m)
      mk.bindPopup(() => popup(c, lang))
      mk.on('dragend', async () => {
        const p = mk.getLatLng()
        try {
          await api(`/api/cameras/${c.id}`, { method: 'PATCH', body: { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) } })
          qc.invalidateQueries({ queryKey: ['cameras'] })
          toast(Lx(`Đã cập nhật vị trí ${c.id}`, `Updated ${c.id} position`), 'success')
        } catch (e) { if (e instanceof ApiError) toast(e.msg(lang), 'error') }
      })
      l.markers[c.id] = mk
    })
  }, [cams, editable, lang, Lx])

  // Route of the selected subject (UR-MAP-04)
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    if (l.route) { m.removeLayer(l.route); l.route = undefined }
    document.querySelectorAll('.cam-pin.hit').forEach(p => p.classList.remove('hit'))
    if (!sel) return
    const pts = sel.path.map(p => cams.find(c => c.id === p.camera_id)).filter((c): c is Camera => !!c && c.lat != null)
    pts.forEach(c => l.markers[c.id]?.getElement()?.querySelector('.cam-pin')?.classList.add('hit'))
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().split(' ').join(',')
    if (pts.length > 1) {
      l.route = L.polyline(pts.map(c => [c.lat!, c.lng!] as [number, number]), { color: `rgb(${accent})`, weight: 3, dashArray: '6 6' }).addTo(m)
      m.flyToBounds(l.route.getBounds(), { padding: [48, 48], duration: 0.8 })
    } else if (pts.length) m.flyTo([pts[0].lat!, pts[0].lng!], 16, { duration: 0.8 })
  }, [sel?.id, cams, theme])

  useEffect(() => { if (map.current) map.current.getContainer().style.cursor = addMode ? 'crosshair' : '' }, [addMode])

  const playRoute = () => {
    if (!sel || !map.current) return
    sel.path.forEach((p, i) => setTimeout(() => {
      const c = cams.find(x => x.id === p.camera_id)
      if (c?.lat != null && map.current) { map.current!.flyTo([c.lat, c.lng!], 17, { duration: 0.9 }); layers.current.markers[c.id]?.openPopup() }
    }, i * 1500))
  }
  const step = (d: number) => {
    const i = tracks.findIndex(x => x.id === sel?.id)
    set({ selectedTrack: tracks[(i + d + tracks.length) % tracks.length]?.id || null })
  }
  const b = sel ? boxAt(sel, sel.t_in) : null
  const unplaced = cams.filter(c => c.lat == null)

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="tabs" role="tablist">
          {(['vehicle', 'gait', 'face'] as const).map(k => <button key={k} role="tab" aria-selected={mapTab === k} onClick={() => set({ mapTab: k, selectedTrack: null })}>{t(k)}</button>)}
        </div>
        {unplaced.length > 0 && <span className="text-xs text-warn inline-flex items-center gap-1"><Icon name="info" />{Lx(`${unplaced.length} camera chưa có vị trí: ${unplaced.map(c => c.id).join(', ')}`, `${unplaced.length} cameras without a location: ${unplaced.map(c => c.id).join(', ')}`)}</span>}
        {editable && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn btn-quiet" data-tip={t('tipAddCoord')} onClick={() => openModal('coord', {})}><Icon name="locate-fixed" />{t('addByCoord')}</button>
            <button className={`btn btn-quiet ${addMode ? '!bg-inverse !text-inverse-fg' : ''}`} aria-pressed={addMode} data-tip={t('tipAddOnMap')} onClick={() => setAddMode(!addMode)}><Icon name="map-pin" />{t('addOnMap')}</button>
          </div>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 relative isolate rounded-lg overflow-hidden border border-line">
          <div ref={box} className="h-[320px] sm:h-[440px] lg:h-full lg:min-h-[440px]" />
          {addMode && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] h-8 px-3 rounded-md bg-inverse text-inverse-fg text-xs flex items-center">{t('clickMapHint')}</div>}
          <div className="absolute top-4 right-4 z-[500]">
            <MenuButton className="icon-btn bg-surface border border-line" label={Lx('Đổi lớp bản đồ', 'Change base map')} tip={`${Lx('Lớp bản đồ', 'Base map')}: ${BASEMAPS[base][lang]}`}
              items={Object.entries(BASEMAPS).map(([k, bm]) => ({ icon: k === base ? 'check' : k === 'satellite' ? 'globe' : k === 'schematic' ? 'route' : 'map', label: bm[lang] + (bm.url && blocked ? ` (${Lx('bị chặn', 'blocked')})` : ''), onClick: () => setBase(k) }))}>
              <Icon name="layers" />
            </MenuButton>
          </div>
        </div>
        <div className="lg:col-span-2 panel flex flex-col overflow-hidden">
          {sel ? <>
            <div className="relative aspect-video bg-black shrink-0">
              <img src={media(`/api/media/videos/${sel.video_id}/frame`, { t: Math.round(sel.t_in * 10) / 10 })} className="w-full h-full object-cover" alt="" />
              {b && <div className="det det-focus" style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}><span className="det-label">{sel.track_id}</span></div>}
            </div>
            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
              <div><h3 className="font-semibold text-sm">{labelOf(sel, lang)} <span className="font-mono text-xs text-muted">{sel.evidence_id}</span></h3><p className="text-xs text-muted mt-1">{attrOf(sel, lang)}</p></div>
              <div><p className="label mb-2">{t('route')}</p>
                <ol className="border-l border-line ml-1 space-y-4">{sel.path.map((p, i) => {
                  const c = cams.find(x => x.id === p.camera_id)
                  return <li key={i} className="pl-4 relative"><span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${p.camera_id === sel.camera_id ? 'bg-accent' : 'bg-fg'}`} />
                    <p className="text-sm">{p.camera_id} <span className="font-mono text-[11px] text-muted ml-1">{hms(p.time)}</span></p><p className="text-xs text-muted">{c?.name || ''}{c && c.lat == null ? ` · ${Lx('chưa có vị trí', 'no location')}` : ''}</p></li>
                })}</ol></div>
              <button className="btn btn-quiet h-8 text-xs" onClick={() => gotoVideo(sel.video_id, sel.t_in, sel.id)}><Icon name="play" className="text-xs" />{t('viewInFootage')}</button>
            </div>
            <div className="p-2 border-t border-line flex items-center justify-center gap-2 shrink-0">
              <button className="icon-btn" aria-label={t('prev')} onClick={() => step(-1)}><Icon name="chevron-left" className="text-xs" /></button>
              <button className="btn btn-quiet" onClick={playRoute}><Icon name="route" className="text-xs" />{t('playRoute')}</button>
              <button className="icon-btn" aria-label={t('next')} onClick={() => step(1)}><Icon name="chevron-right" className="text-xs" /></button>
            </div>
          </> : <div className="flex-1 grid place-items-center text-sm text-muted p-6">{t('noEvents')}</div>}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2"><h2 className="text-sm font-semibold">{t('trackResults')}</h2><span className="text-xs text-muted">{tracks.length} {t('results')}</span></div>
        <div className="grid gap-2 grid-cols-3 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-9">
          {tracks.map(d => (
            <button key={d.id} className="text-left focus-visible:outline-none group cursor-pointer" aria-pressed={sel?.id === d.id} onClick={() => set({ selectedTrack: d.id })}>
              <span className={`block relative aspect-[3/4] rounded-md overflow-hidden bg-subtle ring-1 ${sel?.id === d.id ? 'ring-2 ring-fg' : 'ring-line group-hover:ring-line2'} group-focus-visible:ring-2 group-focus-visible:ring-accent`}>
                <img src={media(mapTab === 'face' ? d.face_url : d.crop_url)} className="w-full h-full object-cover bg-black" alt="" loading="lazy" />
                {d.path.length > 1 && <span className="absolute top-1 right-1 h-5 px-1 rounded bg-inverse text-inverse-fg text-[10px] flex items-center gap-1"><Icon name="route" className="text-[9px]" />{d.path.length}</span>}
              </span>
              <span className="block text-xs font-medium truncate mt-1">{d.kind === 'vehicle' ? d.plate || d.track_id : `${d.track_id} · ${d.evidence_id?.slice(-2)}`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function popup(c: Camera, lang: 'vi' | 'en') {
  const vi = lang === 'vi'
  const el = document.createElement('div')
  el.className = 'text-xs leading-5'
  const vids = (c.videos || []).map(v => v.evidence_id || v.name).join(', ')
  el.innerHTML = `<div class="font-mono font-semibold"></div><div class="nm"></div><div class="font-mono text-muted">${c.lat?.toFixed(5)}, ${c.lng?.toFixed(5)}</div><div class="mt-1 vids"></div><div class="text-muted mt-1">${vi ? 'Kéo ghim để chỉnh vị trí' : 'Drag the pin to adjust'}</div>`
  el.querySelector('.font-semibold')!.textContent = c.id
  el.querySelector('.nm')!.textContent = c.name
  el.querySelector('.vids')!.textContent = vids || (vi ? 'Chưa gán video' : 'No video assigned')
  return el
}
