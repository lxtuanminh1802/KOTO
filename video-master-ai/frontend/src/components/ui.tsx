import {
  ArrowRight, ArrowUp, Bell, Bookmark, Camera, Car, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleAlert, CircleCheck, CircleHelp, CirclePlay,
  Copy, Download, Ellipsis, Eye, EyeOff, FileDown, FileText, FileVideo, Film, Folder, FolderOpen, FolderPlus, Funnel, Globe, Image, ImagePlus, Info, Keyboard,
  Layers, Lightbulb, LoaderCircle, LocateFixed, Lock, LogOut, Map, MapPin, Menu, MessageSquare, Minus, Moon, MousePointerClick, Package, Pause, Pencil, Pentagon,
  Play, Plus, RectangleHorizontal, RefreshCw, RotateCcw, RotateCw, Route, Scan, ScanFace, Scissors, Search, Settings, ShieldAlert, ShieldCheck, Siren,
  SlidersHorizontal, Sparkles, SquarePen, Sun, Trash2, TriangleAlert, Undo2, Upload, User, Users, Video, WandSparkles, X, type LucideIcon,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { COLORS, colorName } from '../lib/domain'
import { isDarkHex } from '../lib/format'
import { useT } from '../lib/i18n'
import { useUI } from '../lib/store'

const ICONS: Record<string, LucideIcon> = {
  'arrow-right': ArrowRight, 'arrow-up': ArrowUp, bell: Bell, bookmark: Bookmark, camera: Camera, car: Car, check: Check, 'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, circle: Circle, 'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-help': CircleHelp,
  'circle-play': CirclePlay, copy: Copy, download: Download, ellipsis: Ellipsis, eye: Eye, 'eye-off': EyeOff, 'file-down': FileDown, 'file-text': FileText,
  'file-video': FileVideo, film: Film, folder: Folder, 'folder-open': FolderOpen, 'folder-plus': FolderPlus, funnel: Funnel, globe: Globe, image: Image,
  'image-plus': ImagePlus, info: Info, keyboard: Keyboard, layers: Layers, lightbulb: Lightbulb, loader: LoaderCircle, 'locate-fixed': LocateFixed, lock: Lock,
  'log-out': LogOut, map: Map, 'map-pin': MapPin, menu: Menu, message: MessageSquare, minus: Minus, moon: Moon, pointer: MousePointerClick, package: Package,
  pause: Pause, pencil: Pencil, pentagon: Pentagon, play: Play, plus: Plus, plate: RectangleHorizontal, refresh: RefreshCw, 'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw, route: Route, scan: Scan, 'scan-face': ScanFace, scissors: Scissors, search: Search, settings: Settings, 'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck, siren: Siren, sliders: SlidersHorizontal, sparkles: Sparkles, 'square-pen': SquarePen, sun: Sun, trash: Trash2,
  'triangle-alert': TriangleAlert, undo: Undo2, upload: Upload, user: User, users: Users, video: Video, wand: WandSparkles, x: X,
}

export function Icon({ name, className = '', fill = false }: { name: string; className?: string; fill?: boolean }) {
  const C = ICONS[name] || Circle
  return <C className={`inline-block w-[1em] h-[1em] shrink-0 ${name === 'loader' ? 'animate-spin' : ''} ${className}`} strokeWidth={1.75} fill={fill ? 'currentColor' : 'none'} aria-hidden="true" />
}

/* ------------------------------------------------------------------ tooltips: any [data-tip] element (UR-HELP-03) */
export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    let owner: Element | null = null
    let timer = 0
    const show = (t: HTMLElement) => {
      if (!t.isConnected || !t.dataset.tip || useUI.getState().tour >= 0) return
      owner = t
      el.textContent = t.dataset.tip
      el.classList.add('on')
      const r = t.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      let top = r.bottom + 8
      if (top + h > innerHeight - 8) top = r.top - h - 8
      el.style.top = top + 'px'
      el.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + 'px'
    }
    const hide = () => {
      clearTimeout(timer)
      owner = null
      el.classList.remove('on')
    }
    const over = (e: MouseEvent) => {
      const t = (e.target as Element).closest?.('[data-tip]') as HTMLElement | null
      if (t === owner) return
      hide()
      if (t) timer = window.setTimeout(() => show(t), 400)
    }
    const focus = (e: FocusEvent) => {
      hide()
      const t = (e.target as Element).closest?.('[data-tip]') as HTMLElement | null
      if (t && t.matches(':focus-visible')) show(t)
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('focusin', focus)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('focusin', focus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('scroll', hide, true)
    }
  }, [])
  return createPortal(<div ref={ref} className="tip" role="tooltip" />, document.body)
}

/* ------------------------------------------------------------------ popover anchored to a trigger */
export function Popover({ anchor, onClose, width = 224, children }: { anchor: HTMLElement | null; onClose: () => void; width?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999 })
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return
    const r = anchor.getBoundingClientRect()
    const mw = ref.current.offsetWidth
    const mh = ref.current.offsetHeight
    setPos({ left: Math.min(Math.max(8, r.right - mw), innerWidth - mw - 8), top: r.bottom + mh + 8 > innerHeight && r.top - mh - 4 > 0 ? r.top - mh - 4 : r.bottom + 4 })
    ref.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [anchor])
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchor?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (items.length) {
          e.preventDefault()
          items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
        }
      }
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor, onClose])
  return createPortal(
    <div ref={ref} className="fixed z-[65] rounded-lg border border-line bg-surface shadow-xl fade-in overflow-hidden" style={{ width: Math.min(width, innerWidth - 16), ...pos }}>
      {children}
    </div>,
    document.body,
  )
}

export interface MenuItem {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

export function MenuList({ items, onClose, header }: { items: MenuItem[]; onClose: () => void; header?: ReactNode }) {
  return (
    <>
      {header}
      <div className="py-1" role="menu">
        {items.filter(i => !i.hidden).map(i => (
          <button key={i.label} role="menuitem"
            className={`w-full flex items-center gap-2 h-9 px-3 text-sm text-left hover:bg-subtle focus-visible:bg-subtle focus-visible:outline-none cursor-pointer ${i.danger ? 'text-danger' : ''}`}
            onClick={() => { onClose(); i.onClick() }}>
            <Icon name={i.icon} className={`text-sm ${i.danger ? '' : 'text-muted'}`} />
            {i.label}
          </button>
        ))}
      </div>
    </>
  )
}

/** Button that toggles a popover menu. */
export function MenuButton({ items, className, label, children, tip, header, width }: { items: MenuItem[]; className: string; label: string; children: ReactNode; tip?: string; header?: ReactNode; width?: number }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button className={className} aria-label={label} aria-haspopup="menu" aria-expanded={!!anchor} data-tip={tip} onClick={e => setAnchor(anchor ? null : e.currentTarget)}>
        {children}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={width}>
          <MenuList items={items} onClose={() => setAnchor(null)} header={header} />
        </Popover>
      )}
    </>
  )
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label className="flex items-center justify-between gap-4 h-9 cursor-pointer text-sm">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  )
}

export function Swatch({ color, pressed, onClick }: { color: string; pressed: boolean; onClick: () => void }) {
  const lang = useUI(s => s.lang)
  const hex = COLORS[color]?.hex || '#999'
  return (
    <button type="button" className="swatch" aria-pressed={pressed} title={colorName(color, lang)} aria-label={colorName(color, lang)} onClick={onClick}
      style={{ background: hex, ['--ck' as any]: isDarkHex(hex) ? '#fff' : '#15171C' }} />
  )
}

export function Dots({ colors }: { colors: string[] }) {
  const lang = useUI(s => s.lang)
  return (
    <span className="flex gap-1">
      {colors.map((c, i) => (
        <span key={i} className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[c]?.hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} title={colorName(c, lang)} />
      ))}
    </span>
  )
}

export function VideoTag({ clip }: { clip: boolean }) {
  const { L } = useT()
  return clip ? (
    <span className="tag tag-clip"><Icon name="scissors" className="text-[9px]" />{L('Đoạn cắt', 'Clip')}</span>
  ) : (
    <span className="tag tag-orig">{L('Gốc', 'Original')}</span>
  )
}

/** Middle-truncated file name that always keeps the "_Cut_N.ext" tail visible (UR-CASE-02). */
export function FileName({ name, clip }: { name: string; clip: boolean }) {
  const m = clip ? name.match(/^(.*?)(_Cut_\d+(?:\.\w+)?)$/) : null
  return m ? (
    <span className="flex min-w-0" title={name}><span className="truncate">{m[1]}</span><span className="shrink-0">{m[2]}</span></span>
  ) : (
    <span className="truncate" title={name}>{name}</span>
  )
}

export function Toasts() {
  const toasts = useUI(s => s.toasts)
  const icon = { info: 'info', success: 'circle-check', warn: 'triangle-alert', error: 'circle-alert' } as const
  const tone = { info: 'text-muted', success: 'text-ok', warn: 'text-warn', error: 'text-danger' } as const
  return (
    <div className="fixed z-[70] left-1/2 -translate-x-1/2 bottom-20 lg:bottom-6 flex flex-col items-center gap-2 w-[min(460px,calc(100vw-32px))]" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} role="status" className="fade-in flex items-center gap-2 min-h-9 py-1.5 px-3 rounded-md bg-surface text-fg border border-line2 text-sm shadow-xl max-w-full">
          <Icon name={icon[t.type]} className={`text-sm ${tone[t.type]}`} />
          <span className="min-w-0">{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Icon name="loader" className={`text-accent ${className}`} />
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="min-h-[240px] grid place-items-center text-center p-6">
      <div className="max-w-xs">
        <p className="font-medium">{title}</p>
        {hint && <p className="text-sm text-muted mt-2">{hint}</p>}
        {children}
      </div>
    </div>
  )
}

export function Modal({ children, size = 'sm:max-w-lg', onClose, label }: { children: ReactNode; size?: string; onClose: () => void; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const last = document.activeElement as HTMLElement | null
    setTimeout(() => box.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]), select, textarea, button')?.focus(), 30)
    return () => last?.focus?.()
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={label}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={box} className={`relative w-full ${size} max-h-[92vh] overflow-y-auto bg-surface border border-line rounded-t-xl sm:rounded-xl shadow-2xl modal-in`}>{children}</div>
    </div>,
    document.body,
  )
}

export function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-danger mt-1" role="alert">{msg}</p> : null
}
