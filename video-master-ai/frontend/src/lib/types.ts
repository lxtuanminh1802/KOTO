export type Role = 'INVESTIGATOR' | 'EXPERT' | 'COMMANDER' | 'VIEWER' | 'ADMIN'

export interface UserSettings {
  min_conf: number
  watermark: boolean
  auto_redact: boolean
  notify: boolean
  theme: 'light' | 'dark'
  lang: 'vi' | 'en'
  idle_lock_minutes: number
}

export interface Me {
  id: string
  username: string
  full_name: string
  title: string
  unit: string
  role: Role
  settings: UserSettings
  permissions: string[]
  welcome_seen: boolean
  has_pin: boolean
}

export interface Case {
  id: string
  code: string
  title: string
  decision_no: string
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'
  opened_at: string
  lead_user_id: string
  lead_name: string
  report_exported: boolean
}

export interface Camera {
  id: string
  name: string
  lat: number | null
  lng: number | null
  clock_offset_sec: number
  videos?: { id: string; evidence_id: string | null; name: string }[]
}

export type VideoState = 'UPLOADING' | 'HASHING' | 'REJECTED' | 'QUEUED' | 'ANALYZING' | 'ANALYZED' | 'FAILED' | 'REMOVED'

export interface Modes {
  person: { gait: boolean; attr: boolean; face: boolean; mask: boolean }
  vehicle: { color: boolean; plate: boolean }
}

export interface Video {
  id: string
  evidence_id: string | null
  case_id: string
  parent_id: string | null
  name: string
  original_file_name: string
  size_bytes: number
  sha256: string | null
  integrity: 'UNKNOWN' | 'OK' | 'MISMATCH'
  verified_at: string | null
  state: VideoState
  progress: number
  camera_id: string
  camera: Camera | null
  recorded_start: string
  duration: number
  width: number
  height: number
  clip_start: number | null
  clip_end: number | null
  cut_seq: number
  source: 'NVR' | 'TRAFFIC' | 'PHONE' | 'OTHER'
  acquired_at: string
  acquired_by: string
  analysis: { fps: string; modes: Modes; version: number; engine: string; label_vi: string; label_en: string }
  alerts: number
  objects: number | null
  has_file: boolean
  error: string | null
  thumb_url: string | null
}

export interface Box {
  t: number
  x: number
  y: number
  w: number
  h: number
}

export interface Attributes {
  gender?: 'm' | 'f'
  top?: 'long' | 'short'
  top_color?: string
  bottom?: 'pants' | 'shorts' | 'skirt'
  bottom_color?: string
  mask?: boolean
  accessories?: string[]
  gait?: string
  vehicle_type?: string
  color?: string
}

export interface Detection {
  id: string
  video_id: string
  track_id: string
  kind: 'person' | 'vehicle'
  t_in: number
  t_out: number
  boxes: Box[]
  attributes: Attributes
  plate: string | null
  plate_confidence: number | null
  plate_alternatives: { text: string; confidence: number }[]
  confidence: number
  path: { camera_id: string; time: string }[]
  watch_item_id: string | null
  alerted: boolean
  has_face: boolean
  crop_url: string | null
  face_url: string | null
}

export interface ResultItem extends Detection {
  evidence_id: string | null
  video_name: string
  camera_id: string
  camera_name: string
  is_clip: boolean
  abs_in: string
  abs_out: string
  tag_color: string | null
  similarity?: number
  query_index?: number | null
  enter_t?: number
  exit_t?: number
}

export interface Zone {
  id: string
  code: string
  name: string
  video_id: string
  evidence_id: string | null
  video_name: string
  polygon: number[][]
  people: boolean
  vehicles: boolean
  pending: boolean
  hits: ResultItem[]
  thumb_t: number
}

export interface Tag {
  id: string
  case_id: string
  video_id: string
  detection_id: string | null
  t: number
  color: string
  note: string
  created_at: string
  evidence_id?: string | null
  video_name?: string
  camera_id?: string
  abs_time?: string
  detection?: Detection | null
}

export interface Annotation {
  id: string
  track_id: string
  type: 'person' | 'face' | 'vehicle' | 'plate'
  x: number
  y: number
  w: number
  h: number
  c: number
  plate?: string
  alts?: { text: string; confidence: number }[]
}

export interface Snapshot {
  id: string
  case_id: string
  video_id: string | null
  t: number
  url: string
  annotations: Annotation[]
  counts: { p?: number; v?: number; plate_ok?: boolean }
  score: number
  uploaded: boolean
  in_report: boolean
  caption: string
  evidence_id: string | null
  camera_id: string | null
  abs_time: string | null
}

export interface WatchItem {
  id: string
  kind: 'face' | 'plate'
  plate: string | null
  name: string
  note: string
  by: string
  created_at: string
  ref_detection_id: string | null
  images: string[]
}

export interface Notification {
  id: string
  kind: string
  tone: 'ok' | 'warn' | 'danger' | 'accent'
  title_vi: string
  title_en: string
  body_vi: string
  body_en: string
  link: { video?: string; alert?: string; map?: string; case?: string; download?: string; t?: number; tab?: string }
  unread: boolean
  at: string
}

export interface AuditRow {
  seq: number
  at: string
  actor: string
  action: string
  object: string
}

export interface Overview {
  case: Case
  videos: Video[]
  stats: { originals: number; clips: number; analyzing: number; analyzed: number; duration: number; people: number; vehicles: number; tags: number; report_exported: boolean }
  leads: (Detection & { tag_color: string | null })[]
  audit: AuditRow[]
}

export interface Filters {
  gender: string[]
  top: string[]
  bottom: string[]
  mask: string[]
  acc: string[]
  color: string[]
  from: string
  to: string
}

export const emptyFilters = (): Filters => ({ gender: [], top: [], bottom: [], mask: [], acc: [], color: [], from: '', to: '' })
