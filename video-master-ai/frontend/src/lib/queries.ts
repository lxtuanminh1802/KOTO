import { QueryClient, useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Camera, Case, Detection, Notification, Overview, ResultItem, Snapshot, Tag, Video, WatchItem } from './types'

/** Shared empty default so `data = EMPTY` keeps a stable identity across renders. */
export const EMPTY: never[] = []

export const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
})

export const useCases = () => useQuery({ queryKey: ['cases'], queryFn: () => api<Case[]>('/api/cases') })
export const useVideos = () => useQuery({ queryKey: ['videos'], queryFn: () => api<Video[]>('/api/videos') })
export const useOverview = (caseId: string | null) =>
  useQuery({ queryKey: ['overview', caseId], queryFn: () => api<Overview>(`/api/cases/${caseId}/overview`), enabled: !!caseId })
export const useDetections = (videoId: string | null, enabled = true) =>
  useQuery({
    queryKey: ['detections', videoId],
    queryFn: () => api<{ detections: Detection[]; zones: { id: string; name: string; polygon: number[][] }[] }>(`/api/videos/${videoId}/detections`),
    enabled: !!videoId && enabled,
  })
export const useWatch = () => useQuery({ queryKey: ['watch'], queryFn: () => api<{ faces: WatchItem[]; plates: WatchItem[] }>('/api/watch') })
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<Notification[]>('/api/notifications'), refetchInterval: 60_000 })
export const useCameras = () => useQuery({ queryKey: ['cameras'], queryFn: () => api<Camera[]>('/api/cameras') })
export const useTags = (caseId: string | null) => useQuery({ queryKey: ['tags', caseId], queryFn: () => api<Tag[]>(`/api/cases/${caseId}/tags`), enabled: !!caseId })
export const useSnapshots = (caseId: string | null) =>
  useQuery({ queryKey: ['snapshots', caseId], queryFn: () => api<{ snapshots: Snapshot[]; attachments: number }>(`/api/cases/${caseId}/snapshots`), enabled: !!caseId })
export const useTracks = (caseId: string | null, kind: string) =>
  useQuery({ queryKey: ['tracks', caseId, kind], queryFn: () => api<ResultItem[]>('/api/tracks', { query: { kind, case_id: caseId || '' } }), enabled: !!caseId })
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<{ id: string; full_name: string; role: string }[]>('/api/users') })

/** After a write, refresh the views that may show it. */
export function refreshCase() {
  for (const k of ['videos', 'overview', 'tags', 'snapshots', 'tracks', 'search', 'zones', 'detections', 'cases']) qc.invalidateQueries({ queryKey: [k] })
}
