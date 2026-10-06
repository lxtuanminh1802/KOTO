import { auditLabel } from '../lib/auditLabels'
import { media } from '../lib/api'
import { attrOf, COLORS } from '../lib/domain'
import { copyText, fmt, shortHash, stamp } from '../lib/format'
import { useT } from '../lib/i18n'
import { can } from '../lib/perm'
import { EMPTY, useCases, useOverview } from '../lib/queries'
import { gotoVideo, openModal, toast, useUI } from '../lib/store'
import type { Video } from '../lib/types'
import { Empty, FileName, Icon, Spinner, VideoTag } from '../components/ui'

export default function CaseView() {
  const { t, L, lang } = useT()
  const { caseId, videoId, set } = useUI()
  const { data: cases = EMPTY } = useCases()
  const { data, isLoading } = useOverview(caseId)
  if (!caseId || isLoading || !data) return <div className="p-6"><Spinner /></div>
  const c = data.case
  const st = data.stats
  const roots = data.videos.filter(v => !v.parent_id)
  const clipsOf = (v: Video) => data.videos.filter(k => k.parent_id === v.id)

  const steps = [
    { t: L('Tạo vụ án', 'Create case'), done: true, d: c.code },
    { t: L('Tải video lên', 'Upload video'), done: st.originals > 0, d: st.originals ? L(`${st.originals} tệp`, `${st.originals} files`) : '' },
    { t: L('AI phân tích', 'AI analysis'), done: st.originals > 0 && !st.analyzing,
      d: st.analyzing ? L(`${st.analyzed}/${st.originals} xong`, `${st.analyzed}/${st.originals} done`) : st.originals ? L(`${st.people} người · ${st.vehicles} xe`, `${st.people} people · ${st.vehicles} vehicles`) : '' },
    { t: L('Xem và cắt đoạn', 'Review and cut'), done: st.clips > 0, d: st.clips ? L(`${st.clips} đoạn cắt`, `${st.clips} clips`) : '' },
    { t: L('Đánh dấu đối tượng', 'Tag subjects'), done: st.tags > 0, d: st.tags ? L(`${st.tags} thẻ`, `${st.tags} tags`) : '' },
    { t: L('Xuất báo cáo', 'Export report'), done: st.report_exported, d: st.report_exported ? 'PDF' : '' },
  ]
  const cur = steps.findIndex(x => !x.done)
  const doneN = steps.filter(x => x.done).length
  const NEXT: Record<number, { icon: string; t: string; d: string; cta: string; go: () => void }> = {
    1: { icon: 'upload', t: L('Tải video chứng cứ lên', 'Upload video evidence'), d: L('Kéo thả video vào vụ án. Hệ thống tính mã SHA-256 để bảo toàn chứng cứ, rồi AI tự phân tích.', 'Drop video into the case. The system hashes it with SHA-256, then AI analyses it.'), cta: L('Tải video lên', 'Upload video'), go: () => openModal('upload', { caseId }) },
    2: { icon: 'loader', t: L(`AI đang phân tích ${st.analyzing} video`, `AI is analysing ${st.analyzing} videos`), d: L('Bạn có thể xem video ngay. Đối tượng sẽ hiện khi phân tích xong.', 'You can watch now. Subjects appear when analysis finishes.'), cta: L('Xem video', 'Review video'), go: () => set({ tab: 'footage' }) },
    3: { icon: 'scissors', t: L('Xem video và cắt đoạn quan trọng', 'Review video and cut the key moments'), d: L('Tua tới đoạn cần giữ, bấm In và Out, rồi Cắt đoạn. Đoạn cắt thành video con dưới video gốc.', 'Go to the moment, press In and Out, then Cut clip. Clips are filed under the original.'), cta: L('Xem video', 'Review video'), go: () => set({ tab: 'footage' }) },
    4: { icon: 'bookmark', t: L('Tìm và đánh dấu đối tượng', 'Find and tag subjects'), d: L('Tìm bằng mô tả như "nam áo đen đeo ba lô", rồi gắn thẻ kết quả quan trọng.', 'Search by description like "man in black with a backpack", then tag what matters.'), cta: L('Tìm đối tượng', 'Find subjects'), go: () => set({ tab: 'report' }) },
    5: { icon: 'file-down', t: L('Xuất báo cáo PDF', 'Export the PDF report'), d: L('Gom kết quả, ảnh và thẻ thành báo cáo có đóng dấu thời gian và mã băm.', 'Bundle results, images and tags into a report stamped with time and hashes.'), cta: L('Mở Tìm đối tượng', 'Open Find subjects'), go: () => set({ tab: 'report' }) },
  }
  const next = cur > 0 ? NEXT[cur] : null
  const canUpload = can('video.upload', c)
  const statusLabel = { ACTIVE: L('Đang điều tra', 'Under investigation'), SUSPENDED: L('Tạm đình chỉ', 'Suspended'), CLOSED: L('Đã kết thúc', 'Closed') }[c.status]

  return (
    <div className="h-full overflow-y-auto"><div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label">{L('Hồ sơ vụ án', 'Case file')} · <span className="font-mono font-medium">{c.code}</span> · <span className="font-mono font-medium">{c.decision_no}</span></p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{c.title}</h1>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs text-muted">
            <div>{L('Điều tra viên', 'Lead investigator')} <span className="text-fg">{c.lead_name}</span></div>
            <div>{L('Mở hồ sơ', 'Opened')} <span className="text-fg font-mono">{stamp(c.opened_at)}</span></div>
            <div>{L('Trạng thái', 'Status')} <span className="inline-flex items-center gap-1 text-fg"><span className={`w-1.5 h-1.5 rounded-full ${c.status === 'CLOSED' ? 'bg-muted' : 'bg-accent'}`} />{statusLabel}</span></div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="caseSel">{L('Chọn vụ án', 'Choose case')}</label>
          <select id="caseSel" className="inp w-auto pr-8" value={c.id} onChange={e => {
            const id = e.target.value
            set({ caseId: id })
          }}>{cases.map(x => <option key={x.id} value={x.id}>{x.code}</option>)}</select>
          {can('case.edit', c) && <button className="btn btn-quiet" onClick={() => openModal('editCase', { c })}><Icon name="pencil" />{L('Sửa', 'Edit')}</button>}
          <button className="btn btn-quiet" disabled={!canUpload} data-tip={canUpload ? t('tipUploadTo') : c.status === 'CLOSED' ? L('Vụ án đã kết thúc', 'The case is closed') : t('forbidden')} onClick={() => openModal('upload', { caseId })}><Icon name="upload" />{L('Tải video lên', 'Upload video')}</button>
          {can('package', c) && <button className="btn btn-quiet" data-tip={L('Đóng gói video gốc, đoạn cắt, ảnh, kết quả AI, nhật ký và mã băm thành một tệp .zip', 'Pack originals, clips, images, AI results, audit trail and hashes into one .zip')} onClick={() => openModal('package', { caseId })}><Icon name="package" />{L('Xuất gói chứng cứ', 'Evidence package')}</button>}
        </div>
      </header>

      <section className="panel p-5" aria-label={L('Tiến trình xử lý', 'Progress')}>
        <div className="flex items-center justify-between gap-4"><h2 className="text-sm font-bold">{L('Tiến trình xử lý', 'Progress')}</h2><span className="text-xs text-muted">{doneN}/{steps.length} {L('bước', 'steps')}</span></div>
        <ol className="grid grid-cols-3 sm:grid-cols-6 gap-y-5 mt-5">
          {steps.map((s, i) => (
            <li key={i} className="relative flex flex-col items-center text-center px-1">
              {i > 0 && <span className={`hidden sm:block absolute top-3.5 right-1/2 w-full h-0.5 ${s.done || i === cur ? 'bg-accent' : 'bg-line'}`} aria-hidden="true" />}
              <span className={`relative w-7 h-7 rounded-full grid place-items-center text-xs font-bold ${s.done ? 'bg-accent text-accent-fg' : i === cur ? 'bg-surface text-accent ring-2 ring-accent' : 'bg-surface text-muted ring-1 ring-line2'}`}>{s.done ? <Icon name="check" className="text-sm" /> : i + 1}</span>
              <span className={`mt-2 text-xs font-semibold ${i === cur ? 'text-accent' : s.done ? 'text-fg' : 'text-muted'}`}>{s.t}</span>
              <span className="text-2xs text-muted mt-0.5 min-h-[14px]">{s.d}</span>
            </li>
          ))}
        </ol>
        {next ? (
          <div id="nextStep" className="mt-5 flex flex-wrap items-center gap-4 p-4 rounded-lg bg-accent/5 ring-1 ring-inset ring-accent/20">
            <span className="w-10 h-10 rounded-lg bg-accent/10 text-accent grid place-items-center text-lg shrink-0"><Icon name={next.icon} /></span>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-accent">{L('Bước tiếp theo', 'Next step')}</p><p className="text-[15px] font-semibold mt-0.5">{next.t}</p><p className="text-sm text-muted mt-0.5">{next.d}</p></div>
            <button className="btn btn-primary" onClick={next.go} disabled={cur === 1 && !canUpload}>{next.cta}<Icon name="arrow-right" /></button>
          </div>
        ) : (
          <div id="nextStep" className="mt-5 flex items-center gap-3 p-4 rounded-lg bg-ok/5 ring-1 ring-inset ring-ok/25 text-sm"><Icon name="circle-check" className="text-ok text-lg" />{L('Đã hoàn tất các bước. Mọi thao tác vẫn được ghi trong Nhật ký.', 'All steps complete. Every action stays in the audit trail.')}</div>
        )}
      </section>

      <section className="panel overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 min-h-12 py-2 px-4 border-b border-line">
          <h2 className="text-sm font-bold">{L('Chứng cứ video', 'Video evidence')} <span className="font-normal text-xs text-muted ml-2">{L('Bấm một dòng để mở video', 'Click a row to open the video')}</span></h2>
          <span className="text-xs text-muted">{st.originals} {L('tệp gốc', 'originals')}{st.clips ? ` · ${st.clips} ${L('đoạn cắt', 'clips')}` : ''} · <span className="font-mono">{fmt(st.duration)}</span></span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[780px]">
            <thead><tr className="border-b border-line"><th className="th">{L('Mã', 'ID')}</th><th className="th">{L('Tệp và camera', 'File and camera')}</th><th className="th">{L('Thời gian ghi', 'Recorded')}</th><th className="th">{L('Tiếp nhận', 'Acquired')}</th><th className="th">SHA-256</th><th className="th">{L('Phân tích', 'Analysis')}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {roots.flatMap(v => [v, ...clipsOf(v)]).map(v => (
                <tr key={v.id} className={`hover:bg-subtle cursor-pointer ${v.id === videoId ? 'bg-subtle/60' : ''}`} tabIndex={0}
                  onClick={() => gotoVideo(v.id)} onKeyDown={e => e.key === 'Enter' && gotoVideo(v.id)}>
                  <td className="td font-mono text-xs whitespace-nowrap">{v.parent_id && <span className="text-muted mr-1">└</span>}{v.evidence_id || <span className="text-muted">…</span>}</td>
                  <td className="td min-w-0"><span className="flex items-center gap-3">
                    {v.thumb_url ? <img src={media(v.thumb_url)} className="w-16 h-9 rounded-sm object-cover shrink-0 bg-black" alt="" /> : <span className="w-16 h-9 rounded-sm bg-black shrink-0" />}
                    <span className="min-w-0"><span className="flex items-center gap-1.5"><span className="flex min-w-0 max-w-[230px]"><FileName name={v.name} clip={!!v.parent_id} /></span><VideoTag clip={!!v.parent_id} /></span>
                      <span className="block text-xs text-muted truncate max-w-[240px]">{v.camera_id}{v.camera?.name ? `, ${v.camera.name}` : ''}</span></span></span></td>
                  <td className="td font-mono text-xs whitespace-nowrap">{stamp(v.recorded_start)}<span className="block text-muted">{fmt(v.duration)}</span></td>
                  <td className="td text-xs whitespace-nowrap"><span className="font-mono">{stamp(v.acquired_at)}</span><span className="block text-muted">{v.acquired_by}</span></td>
                  <td className="td whitespace-nowrap">{v.sha256 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-xs" title={v.sha256}>{shortHash(v.sha256)}</span>
                      {v.integrity === 'MISMATCH' ? <span className="inline-flex items-center gap-1 text-2xs text-danger font-semibold"><Icon name="shield-alert" className="text-xs" />{L('Lệch', 'Mismatch')}</span>
                        : <span className="inline-flex items-center gap-1 text-2xs text-ok"><Icon name="shield-check" className="text-xs" />{L('Khớp', 'Match')}</span>}
                      <button className="icon-btn-sm w-6 h-6" aria-label={L('Sao chép mã băm', 'Copy hash')} data-tip={L('Sao chép mã băm', 'Copy hash')}
                        onClick={e => { e.stopPropagation(); copyText(v.sha256!); toast(L('Đã sao chép', 'Copied') + ` SHA-256 ${shortHash(v.sha256)}`, 'success') }}><Icon name="copy" className="text-xs" /></button>
                    </span>) : <span className="text-xs text-muted">{v.state === 'REJECTED' ? L('Bị từ chối', 'Rejected') : L('Đang tính…', 'Computing…')}</span>}</td>
                  <td className="td text-xs whitespace-nowrap">{v.state === 'ANALYZED' ? (<>
                    <span className="inline-flex items-center gap-1 text-fg"><Icon name="circle-check" className="text-xs text-ok" />{v.objects ?? 0} {t('objects')}</span>
                    <span className="block text-2xs text-muted mt-0.5">{lang === 'vi' ? v.analysis.label_vi : v.analysis.label_en}</span></>
                  ) : v.state === 'FAILED' ? <span className="text-danger">{L('Lỗi phân tích', 'Analysis failed')}</span> : (
                    <span className="flex items-center gap-2"><span className="w-20 h-0.5 rounded-full bg-line overflow-hidden"><span className="block h-full bg-accent transition-all" style={{ width: `${v.progress}%` }} /></span>
                      <span className="font-mono text-muted">{v.state === 'ANALYZING' ? `${Math.floor(v.progress)}%` : v.state === 'QUEUED' ? L('Chờ', 'Queued') : '…'}</span></span>
                  )}</td>
                </tr>
              ))}
              {!roots.length && (
                <tr><td colSpan={6} className="td text-center py-10"><p className="text-sm">{L('Vụ án chưa có chứng cứ video.', 'This case has no video evidence yet.')}</p>
                  {canUpload && <button className="btn btn-primary mt-3" onClick={() => openModal('upload', { caseId })}><Icon name="upload" />{L('Tải video lên', 'Upload video')}</button>}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2 items-start">
        <section className="panel overflow-hidden min-w-0">
          <header className="flex items-center justify-between gap-4 h-12 px-4 border-b border-line">
            <h2 className="text-sm font-semibold">{L('Đầu mối ưu tiên', 'Priority leads')}</h2><span className="text-xs text-muted">{L('Xuất hiện ở nhiều camera', 'Seen on several cameras')}</span>
          </header>
          {data.leads.length ? (
            <ul className="divide-y divide-line">{data.leads.map(d => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                <img src={media(d.kind === 'person' ? d.face_url || d.crop_url : d.crop_url)} className="w-9 h-9 rounded-sm object-cover bg-black shrink-0" alt="" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm"><span className="font-mono text-xs text-muted">{d.track_id}</span>
                    <span className="truncate">{d.kind === 'vehicle' ? <><span className="font-mono">{d.plate}</span> · {attrOf(d, lang)}</> : attrOf(d, lang)}</span>
                    {d.tag_color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[d.tag_color]?.hex }} />}
                    {d.watch_item_id && <Icon name="shield-alert" className="text-danger text-xs" />}</span>
                  <span className="block text-xs text-muted truncate">{d.path.map(p => p.camera_id).join(' → ')}</span>
                </span>
                <span className="text-xs text-muted font-mono hidden sm:inline">{d.confidence}%</span>
                <button className="btn btn-quiet h-7 px-2 text-xs" onClick={() => set({ tab: 'map', mapTab: d.kind === 'vehicle' ? 'vehicle' : 'gait', selectedTrack: d.id })}><Icon name="route" className="text-xs" />{L('Lộ trình', 'Route')}</button>
                <button className="btn btn-quiet h-7 px-2 text-xs" onClick={() => gotoVideo(d.video_id, d.t_in, d.id)}><Icon name="play" className="text-xs" /><span className="hidden sm:inline">{L('Xem', 'View')}</span></button>
              </li>
            ))}</ul>
          ) : <p className="px-4 py-6 text-sm text-muted">{L('Chưa có đối tượng xuất hiện ở nhiều camera.', 'No subject seen on more than one camera yet.')}</p>}
        </section>

        <section className="panel overflow-hidden">
          <header className="flex items-center justify-between gap-4 h-12 px-4 border-b border-line">
            <h2 className="text-sm font-semibold">{L('Nhật ký thao tác', 'Audit trail')}</h2><span className="text-xs text-muted">{L('Chuỗi lưu giữ chứng cứ', 'Chain of custody')}</span>
          </header>
          {data.audit.length ? (
            <ol className="max-h-[460px] overflow-y-auto divide-y divide-line">{data.audit.map(e => (
              <li key={e.seq} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-3"><span className="text-sm">{auditLabel(e.action, lang)}</span><span className="font-mono text-2xs text-muted shrink-0">{stamp(e.at)}</span></div>
                <div className="text-xs text-muted mt-0.5 truncate">{e.actor}{e.object ? <> · <span className="font-mono">{e.object}</span></> : null}</div>
              </li>
            ))}</ol>
          ) : <Empty title={L('Bạn không có quyền xem nhật ký vụ án.', 'You cannot view this case\'s audit trail.')} />}
        </section>
      </div>
    </div></div>
  )
}

