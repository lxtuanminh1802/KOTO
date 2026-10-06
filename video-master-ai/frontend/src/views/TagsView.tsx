import { useRef, useState } from 'react'
import { api, media } from '../lib/api'
import { COLORS, colorName, TAG_COLORS } from '../lib/domain'
import { dmy, fmt, hms } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, qc, useCases, useTags } from '../lib/queries'
import { gotoVideo, toast, useUI } from '../lib/store'
import { Empty, Icon } from '../components/ui'

/** UR-TAG-02: every tag of the case in one grid; notes save as you type. */
export default function TagsView() {
  const { t, L, lang } = useT()
  const [cf, setCf] = useState<string | null>(null)
  const caseId = useUI(s => s.caseId)
  const { data: cases = EMPTY } = useCases()
  const c = cases.find(x => x.id === caseId)
  const { data: tags = EMPTY } = useTags(caseId)
  const timers = useRef<Record<string, number>>({})
  const list = tags.filter(x => !cf || x.color === cf)
  const editable = can('tag', c)
  const patch = (id: string, body: Record<string, string>) => api(`/api/tags/${id}`, { method: 'PATCH', body }).then(() => qc.invalidateQueries({ queryKey: ['tags'] }))
  const del = async (id: string) => {
    await api(`/api/tags/${id}`, { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['tags'] })
    qc.invalidateQueries({ queryKey: ['overview'] })
    toast(L('Đã xóa thẻ', 'Tag deleted'), 'success')
  }
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div><h1 className="text-base font-semibold">{t('tagsTitle')}</h1><p className="text-xs text-muted mt-1">{t('tagsSub')}</p></div>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <button className="chip h-7 text-xs" aria-pressed={!cf} onClick={() => setCf(null)}>{t('allColors')}</button>
          {[...new Set(tags.map(x => x.color))].map(col => (
            <button key={col} className="chip h-7 text-xs" aria-pressed={cf === col} onClick={() => setCf(col)}><span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[col]?.hex }} />{colorName(col, lang)}</button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {list.map(tg => (
            <article key={tg.id} className="panel overflow-hidden">
              <div className="relative aspect-[16/10] bg-black">
                <img src={media(`/api/media/videos/${tg.video_id}/frame`, { t: Math.round(tg.t * 10) / 10 })} className="w-full h-full object-cover" alt="" loading="lazy" />
                <span className="absolute bottom-2 right-2 h-6 px-2 rounded bg-black/60 text-white text-[11px] font-mono flex items-center">{fmt(tg.t)}</span>
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <button className="w-4 h-4 rounded-full shrink-0 ring-offset-2 ring-offset-surface hover:ring-2 hover:ring-line2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer disabled:cursor-default"
                    style={{ background: COLORS[tg.color]?.hex }} title={t('cycleColor')} aria-label={t('cycleColor')} disabled={!editable}
                    onClick={() => patch(tg.id, { color: TAG_COLORS[(TAG_COLORS.indexOf(tg.color) + 1) % TAG_COLORS.length] })} />
                  <input className="flex-1 min-w-0 bg-transparent text-sm font-medium border-b border-transparent hover:border-line focus:border-accent outline-none py-1" defaultValue={tg.note}
                    placeholder={t('notePh')} aria-label={L('Ghi chú', 'Note')} readOnly={!editable}
                    onChange={e => { const v = e.target.value; clearTimeout(timers.current[tg.id]); timers.current[tg.id] = window.setTimeout(() => patch(tg.id, { note: v }), 600) }} />
                </div>
                <p className="text-[11px] text-muted truncate">{tg.video_name}, <span className="font-mono">{tg.abs_time ? `${hms(tg.abs_time)} ${dmy(tg.abs_time)}` : ''}</span></p>
                <div className="flex items-center gap-2 pt-2">
                  <button className="btn btn-quiet h-8 text-xs flex-1" onClick={() => gotoVideo(tg.video_id, tg.t, tg.detection_id)}>{t('viewInFootage')}</button>
                  {editable && <button className="icon-btn-sm hover:!text-danger" aria-label={t('deleteTag')} onClick={() => del(tg.id)}><Icon name="trash" className="text-xs" /></button>}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : <Empty title={t('noTags')} hint={t('noTagsHint')} />}
    </div>
  )
}
