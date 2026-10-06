import { createSHA256 } from 'hash-wasm'
import { create } from 'zustand'
import { api, ApiError } from './api'
import { refreshCase } from './queries'
import type { Modes, Video } from './types'

/** Background uploads survive closing the dialog (UR-EVD-08). Chunked and resumable: on a network error the
 *  client asks the server how much it has and continues from there (NFR-PERF-01). SHA-256 is computed on the
 *  client while reading the file, then compared with the server's hash. */
export interface UploadItem {
  key: string
  name: string
  size: number
  phase: 'upload' | 'hash' | 'done' | 'error'
  pct: number
  evidenceId?: string
  sha?: string
  error?: string
}

interface UploadStore {
  items: Record<string, UploadItem>
  patch: (key: string, p: Partial<UploadItem>) => void
}

export const useUploads = create<UploadStore>(set => ({
  items: {},
  patch: (key, p) => set(s => ({ items: { ...s.items, [key]: { ...s.items[key], ...p } } })),
}))

export interface UploadJob {
  file: File
  caseId: string
  cameraId: string
  source: string
  fps: string
  modes: Modes
  duration?: number
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function startUpload(job: UploadJob, key: string) {
  const { patch } = useUploads.getState()
  useUploads.setState(s => ({ items: { ...s.items, [key]: { key, name: job.file.name, size: job.file.size, phase: 'upload', pct: 0 } } }))
  try {
    const init = await api<{ upload_id: string; chunk_size: number }>('/api/uploads/init', {
      body: { case_id: job.caseId, file_name: job.file.name, size: job.file.size, camera_id: job.cameraId, source: job.source, fps: job.fps, modes: job.modes, duration: job.duration },
    })
    refreshCase()
    const hasher = await createSHA256()
    hasher.init()
    let offset = 0
    let hashed = 0
    let tries = 0
    while (offset < job.file.size) {
      const chunk = job.file.slice(offset, offset + init.chunk_size)
      const buf = new Uint8Array(await chunk.arrayBuffer())
      try {
        const r = await api<{ received: number }>(`/api/uploads/${init.upload_id}`, { method: 'PUT', body: buf.buffer as ArrayBuffer, query: { offset } })
        if (offset === hashed) {
          hasher.update(buf)
          hashed += buf.length
        }
        offset = r.received
        tries = 0
      } catch (e) {
        if (e instanceof ApiError && e.status < 500 && e.status !== 409) throw e
        if (++tries > 30) throw e
        await sleep(Math.min(16000, 1000 * 2 ** Math.min(tries, 4)))
        const st = await api<{ received: number }>(`/api/uploads/${init.upload_id}`).catch(() => null)
        if (st) offset = Math.min(st.received, hashed)  // resume where both sides agree
      }
      patch(key, { pct: Math.floor((offset / job.file.size) * 100) })
    }
    patch(key, { phase: 'hash', pct: 100 })
    const sha = hasher.digest('hex')
    const v = await api<Video>(`/api/uploads/${init.upload_id}/complete`, { body: { sha256: sha } })
    patch(key, { phase: 'done', evidenceId: v.evidence_id || '', sha })
  } catch (e) {
    patch(key, { phase: 'error', error: e instanceof ApiError ? e.vi + '|' + e.en : String(e) })
  } finally {
    refreshCase()
  }
}

/** Duration and a thumbnail from the middle of the file, read locally before upload (UR-EVD-02). */
export function readVideoMeta(file: File): Promise<{ duration: number; thumb: string | null }> {
  return new Promise(res => {
    const url = URL.createObjectURL(file)
    const vd = document.createElement('video')
    vd.muted = true
    vd.preload = 'auto'
    vd.src = url
    let done = false
    const fin = (thumb: string | null) => {
      if (done) return
      done = true
      res({ duration: isFinite(vd.duration) && vd.duration > 0 ? vd.duration : 0, thumb })
      URL.revokeObjectURL(url)
    }
    vd.onloadeddata = () => {
      vd.currentTime = Math.min(1, (vd.duration || 2) / 2)
    }
    vd.onseeked = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 320
        c.height = 180
        c.getContext('2d')!.drawImage(vd, 0, 0, 320, 180)
        fin(c.toDataURL('image/jpeg', 0.75))
      } catch {
        fin(null)
      }
    }
    vd.onerror = () => fin(null)
    setTimeout(() => fin(null), 6000)
  })
}
