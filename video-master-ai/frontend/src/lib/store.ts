import { create } from 'zustand'
import { emptyFilters, type Filters } from './types'

export type Tab = 'case' | 'footage' | 'report' | 'tags' | 'map' | 'image'
export type ReportTab = 'person' | 'gait' | 'face' | 'zone' | 'vehicle' | 'plate'
export type ToastType = 'info' | 'success' | 'warn' | 'error'

export interface Toast { id: number; msg: string; type: ToastType }
export interface AlertCard { id: string; detection_id: string; video_id: string; t: number; label: string; similarity: number; where: string; note: string }
export interface ModalState { kind: string; props?: Record<string, any> }

export interface LabState {
  snapId: string | null
  layers: { person: boolean; vehicle: boolean; plate: boolean; face: boolean }
  tool: 'region' | null
  oneTouch: boolean
  scene: string | null
  opts: { super: boolean; deblur: boolean; denoise: boolean }
  manual: { bright: number; contrast: number; sat: number; sharp: number; zoom: number; gray: boolean; invert: boolean; edge: boolean }
  panX: number
  panY: number
  split: number
  redact: boolean
  region: { x: number; y: number; w: number; h: number; done: boolean } | null
  ocr: string | null
}

export const labDefaults = (): Omit<LabState, 'snapId' | 'layers' | 'tool'> => ({
  oneTouch: false, scene: null, opts: { super: true, deblur: false, denoise: false },
  manual: { bright: 100, contrast: 100, sat: 100, sharp: 0, zoom: 1, gray: false, invert: false, edge: false },
  panX: 0, panY: 0, split: 50, redact: false, region: null, ocr: null,
})

interface UI {
  lang: 'vi' | 'en'
  theme: 'light' | 'dark'
  tab: Tab
  caseId: string | null
  videoId: string | null
  checked: Record<string, boolean>
  closedCases: Record<string, boolean>
  // footage
  t: number
  playing: boolean
  speed: number
  zoom: number
  inT: number | null
  outT: number | null
  focusDet: string | null
  evKind: 'all' | 'person' | 'vehicle'
  overlayOff: Record<string, boolean>
  venh: { on: boolean; opts: { denoise: boolean; lowlight: boolean; stab: boolean; super: boolean; deblur: boolean }; split: number }
  pendingSeek: { videoId: string; t: number } | null
  // search
  reportTab: ReportTab
  searchMode: 'text' | 'face' | 'plate'
  filters: Filters
  sort: 'time' | 'conf'
  plateQuery: string
  faceQuery: { id: string; count: number; same: boolean } | null
  nlParsed: { text: string; none?: boolean } | null
  nlUndo: { filters: Filters; tab: ReportTab } | null
  resultCount: number
  // map
  mapTab: 'vehicle' | 'gait' | 'face'
  selectedTrack: string | null
  // image lab
  lab: LabState
  // chrome
  aiOpen: boolean
  aiPrefill: string | null
  sidebarOpen: boolean
  filterOpen: boolean
  labPanelOpen: boolean
  modal: ModalState | null
  toasts: Toast[]
  alerts: AlertCard[]
  locked: boolean
  tour: number
  set: (p: Partial<UI> | ((s: UI) => Partial<UI>)) => void
}

export const useUI = create<UI>(set => ({
  lang: 'vi', theme: 'light', tab: 'case', caseId: null, videoId: null, checked: {}, closedCases: {},
  t: 0, playing: false, speed: 1, zoom: 1, inT: null, outT: null, focusDet: null, evKind: 'all', overlayOff: {},
  venh: { on: false, opts: { denoise: true, lowlight: true, stab: false, super: false, deblur: false }, split: 50 }, pendingSeek: null,
  reportTab: 'person', searchMode: 'text', filters: emptyFilters(), sort: 'time', plateQuery: '', faceQuery: null, nlParsed: null, nlUndo: null, resultCount: 0,
  mapTab: 'gait', selectedTrack: null,
  lab: { snapId: null, layers: { person: true, vehicle: true, plate: true, face: false }, tool: null, ...labDefaults() },
  aiOpen: false, aiPrefill: null, sidebarOpen: false, filterOpen: false, labPanelOpen: false, modal: null, toasts: [], alerts: [], locked: false, tour: -1,
  set: p => set(typeof p === 'function' ? p : () => p),
}))

let toastId = 0
export function toast(msg: string, type: ToastType = 'info') {
  const id = ++toastId
  useUI.setState(s => ({ toasts: [...s.toasts, { id, msg, type }] }))
  setTimeout(() => useUI.setState(s => ({ toasts: s.toasts.filter(x => x.id !== id) })), 3400)
}

export const openModal = (kind: string, props?: Record<string, any>) => useUI.setState({ modal: { kind, props } })
export const closeModal = () => useUI.setState({ modal: null })

/** Jump to a moment in a video (used by results, tags, alerts, the assistant). */
export function gotoVideo(videoId: string, t = 0, focus: string | null = null, caseId?: string) {
  useUI.setState(s => ({ tab: 'footage', videoId, pendingSeek: { videoId, t }, focusDet: focus, inT: null, outT: null, zoom: 1, playing: false, modal: null, sidebarOpen: false, caseId: caseId || s.caseId }))
}
