import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, ApiError, media } from '../lib/api'
import { fmtSize } from '../lib/format'
import { useT } from '../lib/i18n'
import { EMPTY, qc, refreshCase, useCases } from '../lib/queries'
import { closeModal, toast } from '../lib/store'
import { FieldError, Icon, Modal } from '../components/ui'

/* ------------------------------------------------------------------ UR-RPT-01 */
export function PdfDialog({ ids, query, caseId }: { ids: string[]; query: string; caseId: string }) {
  const { L, lang } = useT()
  const { data: cases = EMPTY } = useCases()
  const c = cases.find(x => x.id === caseId)
  const steps = [L('Tổng hợp kết quả', 'Collecting results'), L('Kết xuất ảnh đối tượng', 'Rendering images'), L('Đóng dấu thời gian và mã băm', 'Stamping time and hashes')]
  const [step, setStep] = useState(0)
  const [res, setRes] = useState<{ file_name: string; sha256: string; url: string; count: number } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const timer = setInterval(() => setStep(s => Math.min(s + 1, steps.length - 1)), 600)
    api<{ file_name: string; sha256: string; url: string; count: number }>(`/api/cases/${caseId}/report`, { body: { detection_ids: ids, query } })
      .then(r => { setRes(r); setStep(steps.length); refreshCase(); qc.invalidateQueries({ queryKey: ['notifications'] }); toast(L(`Đã tạo báo cáo PDF, ${r.count} kết quả`, `PDF report created, ${r.count} results`), 'success') })
      .catch(e => setErr(e instanceof ApiError ? e.msg(lang) : String(e)))
      .finally(() => clearInterval(timer))
    return () => clearInterval(timer)
  }, [])
  return (
    <Modal onClose={closeModal} size="sm:max-w-md" label={L('Đang tạo báo cáo', 'Building report')}>
      <div className="p-6 space-y-6">
        <div><h2 className="font-semibold">{res ? L('Báo cáo đã sẵn sàng', 'Report ready') : L('Đang tạo báo cáo', 'Building report')}</h2><p className="text-sm text-muted mt-1">{res?.file_name || `BaoCao_${c?.code || ''}.pdf`}</p></div>
        <ol className="space-y-2">{steps.map((s, i) => (
          <li key={i} className={`flex items-center gap-2 text-sm ${i <= step ? 'text-fg' : 'text-muted'}`}>
            {i < step || res ? <Icon name="circle-check" className="text-sm text-ok" /> : i === step && !err ? <Icon name="loader" className="text-sm text-accent" /> : <Icon name="circle" className="text-sm" />}{s}</li>
        ))}</ol>
        <div className="h-1 rounded-full bg-line overflow-hidden"><div className="h-full bg-fg transition-all duration-500" style={{ width: `${(Math.min(step, steps.length) / steps.length) * 100}%` }} /></div>
        {res && <p className="text-xs text-muted font-mono break-all">SHA-256 {res.sha256}</p>}
        <FieldError msg={err} />
        <div className="flex justify-end gap-2">
          <button className="btn btn-quiet" onClick={closeModal}>{L('Đóng', 'Close')}</button>
          {res && <a className="btn btn-primary" href={media(res.url)} download={res.file_name}><Icon name="download" />{L('Tải PDF', 'Download PDF')}</a>}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ UR-RPT-03, WF-08 */
export function PackageDialog({ caseId }: { caseId: string }) {
  const { L, lang } = useT()
  const { data: cases = EMPTY } = useCases()
  const c = cases.find(x => x.id === caseId)
  const { data: pv } = useQuery({ queryKey: ['pkgPreview', caseId], queryFn: () => api<Record<string, any>>(`/api/cases/${caseId}/package/preview`) })
  const [opt, setOpt] = useState<Record<string, boolean>>({ video: true, clips: true, images: true, dets: true, tags: true, log: true, report: true })
  const [phase, setPhase] = useState<'pick' | 'run' | 'done' | 'error'>('pick')
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')
  const items: [string, string, string, string][] = [
    ['video', 'file-video', L('Video gốc', 'Original videos'), L('Đóng gói nguyên byte như lúc tiếp nhận.', 'Packed byte for byte as acquired.')],
    ['clips', 'scissors', L('Đoạn cắt', 'Clips'), L('Tệp video và mô tả JSON (khoảng cắt, video gốc, mã băm).', 'Video files and JSON records (range, parent, hash).')],
    ['images', 'image', L('Ảnh chụp và ảnh đã xử lý', 'Snapshots and processed images'), ''],
    ['dets', 'users', L('Kết quả nhận diện AI', 'AI detection results'), 'CSV'],
    ['tags', 'bookmark', L('Thẻ đánh dấu', 'Tags'), 'CSV'],
    ['log', 'shield-check', L('Nhật ký thao tác (chuỗi lưu giữ)', 'Audit trail (chain of custody)'), 'CSV'],
    ['report', 'file-text', L('Báo cáo tổng hợp', 'Summary report'), 'HTML'],
  ]
  const build = async () => {
    setPhase('run')
    try { setRes(await api(`/api/cases/${caseId}/package`, { body: opt })); setPhase('done'); refreshCase() }
    catch (e) { setErr(e instanceof ApiError ? e.msg(lang) : String(e)); setPhase('error'); refreshCase() }
  }
  const ymd = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return (
    <Modal onClose={closeModal} size="sm:max-w-xl" label={L('Xuất gói chứng cứ', 'Export evidence package')}>
      <div className="flex flex-col max-h-[90vh]">
        <header className="px-6 pt-6 pb-4 border-b border-line"><h2 className="text-lg font-bold">{L('Xuất gói chứng cứ', 'Export evidence package')}</h2>
          <p className="text-sm text-muted mt-1">{L(`Đóng gói chứng cứ của vụ án ${c?.code} thành một tệp .zip, kèm bản kê mã băm SHA-256 để bên nhận kiểm tra tính toàn vẹn.`, `Pack case ${c?.code} evidence into one .zip with a SHA-256 manifest so the recipient can verify integrity.`)}</p></header>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-2">
          {phase === 'pick' && <>
            {(pv?.blocked?.length ?? 0) > 0 && <p className="p-3 rounded-lg bg-danger/10 text-danger text-sm"><Icon name="shield-alert" className="mr-1" />{L(`Lệch mã băm: ${pv?.blocked.join(', ')}. Xuất gói sẽ bị chặn.`, `Hash mismatch: ${pv?.blocked.join(', ')}. Export will be blocked.`)}</p>}
            {items.map(([k, icon, t, d]) => {
              const n = pv?.[k] ?? 0
              return <label key={k} className="flex items-start gap-3 p-3 rounded-lg ring-1 ring-line hover:bg-subtle/60 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 mt-0.5 accent-[rgb(var(--accent))]" checked={opt[k] && n > 0} disabled={!n} onChange={e => setOpt(o => ({ ...o, [k]: e.target.checked }))} />
                <Icon name={icon} className="text-accent mt-0.5" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{t} <span className="font-normal text-muted">({n})</span></span>{d && <span className="block text-xs text-muted mt-0.5">{d}</span>}</span></label>
            })}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/5 ring-1 ring-inset ring-accent/20"><Icon name="shield-check" className="text-accent mt-0.5" /><span className="text-sm"><b>SHA256SUMS.txt</b> {L('và README.txt luôn có trong gói. Video gốc được xác minh lại mã băm trước khi đóng gói.', 'and README.txt are always included. Originals are re-hashed before packing.')}</span></div>
          </>}
          {phase !== 'pick' && (
            <ol className="space-y-2">
              {[L('Xác minh lại SHA-256 video gốc', 'Re-verifying original hashes'), L('Thu thập tệp chứng cứ', 'Collecting evidence files'), L('Tính SHA-256 từng tệp', 'Hashing each file'), L('Nén thành .zip', 'Compressing to .zip')].map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-sm">{phase === 'done' ? <Icon name="circle-check" className="text-ok" /> : phase === 'error' ? (i === 0 ? <Icon name="circle-alert" className="text-danger" /> : <Icon name="circle" className="text-muted" />) : <Icon name="loader" className="text-accent" />}{s}</li>
              ))}
            </ol>
          )}
          <FieldError msg={err} />
          {res && (
            <div className="mt-4 p-4 rounded-lg bg-ok/5 ring-1 ring-inset ring-ok/25">
              <p className="text-sm font-semibold flex items-center gap-1.5"><Icon name="package" className="text-ok" />{res.file_name} · {fmtSize(res.size)} · {res.file_count} {L('tệp', 'files')}</p>
              <p className="text-xs text-muted mt-1 font-mono break-all">SHA-256 {res.sha256}</p>
              <ul className="mt-3 max-h-48 overflow-y-auto text-xs font-mono text-muted space-y-0.5">{res.files.map((f: string) => <li key={f} className="truncate">{f}</li>)}</ul>
            </div>
          )}
        </div>
        <footer className="px-6 py-4 border-t border-line flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted flex-1 min-w-[180px] font-mono">{res ? L('Gói đã sẵn sàng. Bấm Lưu để tải về.', 'Package ready. Press Save to download.') : `GoiChungCu_${c?.code}_${ymd}.zip`}</p>
          <span className="flex gap-2 ml-auto"><button className="btn btn-quiet" onClick={closeModal}>{phase === 'done' ? L('Đóng', 'Close') : L('Hủy', 'Cancel')}</button>
            {phase === 'pick' && <button className="btn btn-primary" onClick={build}><Icon name="package" />{L('Tạo gói .zip', 'Build .zip')}</button>}
            {res && <a className="btn btn-primary" href={media(res.url)} download={res.file_name}><Icon name="download" />{L('Lưu tệp .zip', 'Save .zip')}</a>}</span>
        </footer>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ System admin */
export function AdminDialog() {
  const { L, lang } = useT()
  const { data: users = [], refetch } = useQuery({ queryKey: ['adminUsers'], queryFn: () => api<any[]>('/api/admin/users') })
  const { data: chain, refetch: verify } = useQuery({ queryKey: ['chain'], queryFn: () => api<{ ok: boolean; rows: number; first_bad_seq: number | null }>('/api/admin/audit/verify') })
  const [form, setForm] = useState({ username: '', full_name: '', title: '', unit: '', role: 'INVESTIGATOR', password: '', pin: '' })
  const [err, setErr] = useState('')
  const roles: Record<string, string> = { INVESTIGATOR: L('Điều tra viên', 'Investigator'), EXPERT: L('Giám định viên', 'Expert'), COMMANDER: L('Chỉ huy', 'Commander'), VIEWER: L('Người xem', 'Viewer'), ADMIN: L('Quản trị', 'Admin') }
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try { await api('/api/admin/users', { body: form }); setForm({ username: '', full_name: '', title: '', unit: '', role: 'INVESTIGATOR', password: '', pin: '' }); setErr(''); refetch(); toast(L('Đã tạo tài khoản', 'Account created'), 'success') }
    catch (er) { if (er instanceof ApiError) setErr(er.msg(lang)) }
  }
  const patch = async (id: string, body: Record<string, unknown>) => { await api(`/api/admin/users/${id}`, { method: 'PATCH', body }); refetch(); toast(L('Đã cập nhật', 'Updated'), 'success') }
  return (
    <Modal onClose={closeModal} size="sm:max-w-3xl" label={L('Quản lý người dùng', 'User management')}>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-4"><h2 className="text-lg font-bold">{L('Quản lý người dùng', 'User management')}</h2><button className="icon-btn -mr-2 -mt-2" aria-label="close" onClick={closeModal}><Icon name="x" /></button></div>
        {chain && <p className={`text-sm p-3 rounded-lg ${chain.ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}><Icon name={chain.ok ? 'shield-check' : 'shield-alert'} className="mr-1" />
          {chain.ok ? L(`Chuỗi nhật ký hợp lệ (${chain.rows} bản ghi).`, `Audit chain intact (${chain.rows} rows).`) : L(`Chuỗi nhật ký bị sửa đổi tại bản ghi #${chain.first_bad_seq}.`, `Audit chain broken at row #${chain.first_bad_seq}.`)}
          <button className="underline ml-2 cursor-pointer" onClick={() => verify()}>{L('Kiểm tra lại', 'Re-check')}</button></p>}
        <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]"><thead><tr className="border-b border-line"><th className="th">{L('Tài khoản', 'Account')}</th><th className="th">{L('Vai trò', 'Role')}</th><th className="th">2FA</th><th className="th">{L('Trạng thái', 'Status')}</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">{users.map(u => (
            <tr key={u.id}><td className="td"><span className="font-medium">{u.full_name}</span><span className="block text-xs text-muted font-mono">{u.username}</span></td>
              <td className="td"><select className="inp h-8 w-40" value={u.role} onChange={e => patch(u.id, { role: e.target.value })}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td className="td text-xs">{u.totp_confirmed ? L('Đã đăng ký', 'Enrolled') : L('Chưa', 'Not yet')}</td>
              <td className="td text-xs">{!u.active ? L('Vô hiệu', 'Disabled') : u.locked_until && new Date(u.locked_until) > new Date() ? <span className="text-danger">{L('Tạm khóa', 'Locked')}</span> : L('Hoạt động', 'Active')}</td>
              <td className="td text-right whitespace-nowrap">
                <button className="btn btn-ghost h-7 text-xs" onClick={() => patch(u.id, { unlock: true })}>{L('Mở khóa', 'Unlock')}</button>
                <button className="btn btn-ghost h-7 text-xs" onClick={() => patch(u.id, { reset_2fa: true })}>{L('Đặt lại 2FA', 'Reset 2FA')}</button>
                <button className="btn btn-ghost h-7 text-xs" onClick={() => patch(u.id, { active: !u.active })}>{u.active ? L('Vô hiệu', 'Disable') : L('Kích hoạt', 'Enable')}</button></td></tr>
          ))}</tbody></table></div>
        <form className="p-4 rounded-lg bg-subtle/60 ring-1 ring-line grid sm:grid-cols-3 gap-3" onSubmit={create}>
          <h3 className="text-sm font-bold sm:col-span-3">{L('Thêm tài khoản', 'Add account')}</h3>
          {(['username', 'full_name', 'title', 'unit'] as const).map(k => <input key={k} className="inp" placeholder={{ username: L('Tên đăng nhập', 'Username'), full_name: L('Họ tên', 'Full name'), title: L('Chức danh', 'Title'), unit: L('Đơn vị', 'Unit') }[k]} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} />)}
          <select className="inp" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input className="inp" type="password" placeholder={L('Mật khẩu (≥12, hoa, thường, số)', 'Password (12+, upper, lower, digit)')} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          <input className="inp font-mono" inputMode="numeric" maxLength={6} placeholder="PIN" value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '') }))} />
          <div className="sm:col-span-2 self-center"><FieldError msg={err} /></div>
          <button className="btn btn-primary sm:col-start-3"><Icon name="plus" />{L('Tạo tài khoản', 'Create account')}</button>
        </form>
      </div>
    </Modal>
  )
}
