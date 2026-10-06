import { useEffect, useLayoutEffect, useState } from 'react'
import { api, ApiError, getSession, setSession } from '../lib/api'
import { useT } from '../lib/i18n'
import { gotoVideo, toast, useUI, type Tab } from '../lib/store'
import { Icon } from './ui'

/** UR-WATCH-04: red cards bottom-right, kept until closed, at most three. */
export function AlertStack() {
  const { L } = useT()
  const { alerts, set } = useUI()
  const close = (id: string) => set(s => ({ alerts: s.alerts.filter(a => a.id !== id) }))
  return (
    <div className="fixed z-[72] bottom-20 lg:bottom-6 right-4 w-[min(380px,calc(100vw-32px))] flex flex-col gap-2" aria-live="assertive">
      {alerts.map(a => (
        <div key={a.id} role="alert" className="panel shadow-2xl p-4 fade-in flex gap-3 ring-1 ring-danger/40">
          <span className="w-9 h-9 rounded-full bg-danger/10 text-danger grid place-items-center shrink-0"><Icon name="siren" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-danger">{L('Cảnh báo sớm · danh sách theo dõi', 'Early alert · watchlist')}</p>
            <p className="text-sm font-semibold mt-0.5">{a.label} <span className="font-normal text-muted">{a.similarity}%</span></p>
            <p className="text-xs text-muted mt-0.5">{a.where}{a.note ? ` · ${a.note}` : ''}</p>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary h-8 text-xs" onClick={() => {
                close(a.id)
                gotoVideo(a.video_id, a.t, a.detection_id)
              }}><Icon name="play" className="text-xs" />{L('Xem ngay', 'View now')}</button>
              <button className="btn btn-ghost h-8 text-xs" onClick={() => close(a.id)}>{L('Đóng', 'Close')}</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** UR-AUTH-02: everything hidden behind a 6-digit PIN; shortcuts disabled while locked. */
export function LockScreen() {
  const { t, L, lang } = useT()
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const me = getSession()?.user
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(pin)) return setErr(t('pinErr'))
    try {
      await api('/api/auth/unlock', { body: { pin } })
      useUI.setState({ locked: false })
      toast(t('tUnlocked'), 'success')
    } catch (er) {
      setPin('')
      if (er instanceof ApiError) {
        setErr(er.msg(lang))
        if (er.code === 'pin.forced_logout') { useUI.setState({ locked: false }); setSession(null) }
      }
    }
  }
  return (
    <div className="fixed inset-0 z-[80] bg-bg flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="lockTitle">
      <form noValidate onSubmit={submit} className="w-full max-w-sm panel p-8 text-center shadow-2xl modal-in">
        <span className="inline-block rounded-lg bg-white px-3 py-1 ring-1 ring-line"><img src="/aipt-logo.png" alt="AIPT Group" className="h-16 w-auto" /></span>
        <p className="text-xs text-muted mt-2">Video Master AI</p>
        <h2 id="lockTitle" className="text-base font-semibold mt-4">{t('lockTitle')}</h2>
        <p className="text-sm text-muted mt-1">{t('lockSub')}</p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <span className="w-8 h-8 rounded-full bg-subtle ring-1 ring-line grid place-items-center text-2xs font-semibold" aria-hidden="true">{me?.full_name.split(' ').slice(-2).map(w => w[0]).join('')}</span>
          <span className="text-sm font-medium">{me?.full_name}</span>
        </div>
        <label className="block text-left mt-6"><span className="label">{t('pin')}</span>
          <input autoFocus className="inp mt-2 h-11 text-center font-mono text-lg tracking-[.5em]" type="password" inputMode="numeric" maxLength={6} autoComplete="off" aria-invalid={!!err}
            value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr('') }} /></label>
        {err && <p className="text-xs text-danger mt-2 text-left" role="alert">{err}</p>}
        <button className="btn btn-primary w-full h-10 mt-4"><Icon name="lock" className="text-sm" />{t('unlock')}</button>
        <button type="button" className="btn btn-ghost w-full h-8 mt-2 text-xs" onClick={() => { useUI.setState({ locked: false }); api('/api/auth/logout', { method: 'POST' }).finally(() => setSession(null)) }}>{L('Đăng xuất', 'Sign out')}</button>
      </form>
    </div>
  )
}

const TOUR: { sel: string; tab?: Tab; side?: boolean; t: [string, string]; d: [string, string] }[] = [
  { sel: '#newCaseBtn', side: true, t: ['Bắt đầu: tạo vụ án', 'Start here: create a case'], d: ['Mỗi vụ án là một thư mục chứa video chứng cứ, kết quả phân tích và báo cáo.', 'A case is a folder for video evidence, analysis results and the report.'] },
  { sel: '[data-upload-case]', side: true, t: ['Tải video vào vụ án', 'Upload video into the case'], d: ['Bấm biểu tượng tải lên cạnh tên vụ án. Video được tính mã SHA-256 để bảo toàn chứng cứ, rồi AI tự phân tích.', 'Use the upload icon next to the case. Each video is hashed (SHA-256) to preserve evidence, then AI analyses it.'] },
  { sel: '#nextStep', tab: 'case', t: ['Luôn biết việc cần làm', 'Always know what to do next'], d: ['Trang Tổng quan cho thấy tiến trình của vụ án và gợi ý bước tiếp theo bằng một nút.', 'Overview shows the case progress and offers the next step as one button.'] },
  { sel: '#player', tab: 'footage', t: ['Xem video và đối tượng AI', 'Watch video with AI detections'], d: ['Khung trắng là đối tượng AI phát hiện. Danh sách bên phải liệt kê từng đối tượng; bấm vào để tua tới.', 'White boxes are AI detections. The list on the right shows each subject; click one to jump to it.'] },
  { sel: '#cutGroup', tab: 'footage', t: ['Cắt đoạn quan trọng', 'Cut the key moment'], d: ['Tua tới điểm bắt đầu, bấm In; tới điểm kết thúc, bấm Out; rồi Cắt đoạn. Đoạn cắt nằm dưới video gốc ở cột trái.', 'Go to the start, press In; go to the end, press Out; then Cut clip. The clip appears under the original on the left.'] },
  { sel: '#venhBtn', tab: 'footage', t: ['Làm rõ video', 'Clarify the video'], d: ['Khử nhiễu, tăng sáng vùng tối, chống rung. Kéo thanh chia trên video để so sánh trước và sau.', 'Denoise, lift shadows, stabilize. Drag the divider on the video to compare before and after.'] },
  { sel: '#nlForm', tab: 'report', t: ['Tìm đối tượng bằng mô tả', 'Find subjects by description'], d: ['Gõ như nói: "nam áo đen đeo ba lô". Thu hẹp bằng bộ lọc, gắn thẻ kết quả, rồi xuất báo cáo PDF.', 'Type it like you say it: "man in black with a backpack". Narrow with filters, tag results, then export a PDF.'] },
  { sel: '#aiToggle', t: ['Hỏi trợ lý AI', 'Ask the AI assistant'], d: ['Hỏi bằng tiếng Việt về video, ảnh hoặc vụ án, ví dụ "Ai xuất hiện ở nhiều camera?".', 'Ask about the video, image or case, e.g. "Who appears on several cameras?".'] },
  { sel: '#helpBtn', t: ['Cần trợ giúp?', 'Need help?'], d: ['Mở lại hướng dẫn này, phần giới thiệu và phím tắt ở đây. Rê chuột lên mọi nút để xem chú thích.', 'Reopen this tour, the intro and shortcuts here. Hover any button to see what it does.'] },
]

/** UR-HELP-02: nine steps, spotlight + card, ←/→ to move, Esc to leave; hidden controls are skipped. */
export function Tour() {
  const { L, lang } = useT()
  const { tour, set } = useUI()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const st = TOUR[tour]
  useEffect(() => {
    if (!st) { set({ tour: -1 }); return }
    const narrow = innerWidth < 1024
    set({ ...(st.tab ? { tab: st.tab } : {}), sidebarOpen: !!st.side && narrow, searchMode: st.sel === '#nlForm' ? 'text' : useUI.getState().searchMode })
  }, [tour])
  useLayoutEffect(() => {
    if (!st) return
    const place = () => {
      const el = document.querySelector(st.sel) as HTMLElement | null
      if (!el || !el.getClientRects().length) { set({ tour: tour + 1 }); return }
      el.scrollIntoView({ block: 'nearest' })
      setRect(el.getBoundingClientRect())
    }
    const id = setTimeout(place, st.side && innerWidth < 1024 ? 340 : 120)
    addEventListener('resize', place)
    return () => { clearTimeout(id); removeEventListener('resize', place) }
  }, [tour])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ tour: -1, sidebarOpen: false })
      else if (e.key === 'ArrowRight') set({ tour: tour + 1 })
      else if (e.key === 'ArrowLeft') set({ tour: Math.max(0, tour - 1) })
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [tour, set])
  if (!st || !rect) return null
  const pad = 6
  const cw = Math.min(340, innerWidth - 32)
  let left = rect.right + 16
  let top = rect.top
  if (left + cw > innerWidth - 16) { left = Math.min(Math.max(16, rect.left + rect.width / 2 - cw / 2), innerWidth - cw - 16); top = rect.bottom + 16; if (top + 220 > innerHeight - 16) top = rect.top - 236 }
  const end = () => set({ tour: -1, sidebarOpen: false })
  return (
    <>
      <div className="coach" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div role="dialog" aria-label={st.t[lang === 'vi' ? 0 : 1]} className="fixed z-[96] panel p-5 shadow-2xl fade-in" style={{ width: cw, left, top: Math.min(Math.max(16, top), innerHeight - 236) }}>
        <div className="flex items-center gap-2"><span className="text-xs font-bold text-accent">{L('Bước', 'Step')} {tour + 1}/{TOUR.length}</span>
          <span className="flex-1 h-1 rounded-full bg-line overflow-hidden"><span className="block h-full bg-accent" style={{ width: `${((tour + 1) / TOUR.length) * 100}%` }} /></span></div>
        <h3 className="text-[15px] font-bold mt-3">{st.t[lang === 'vi' ? 0 : 1]}</h3>
        <p className="text-sm text-muted mt-1 leading-6">{st.d[lang === 'vi' ? 0 : 1]}</p>
        <div className="flex items-center gap-2 mt-4">
          <button className="btn btn-ghost h-8 px-2 text-xs" onClick={end}>{L('Bỏ qua', 'Skip')}</button><span className="flex-1" />
          {tour > 0 && <button className="btn btn-quiet h-8 text-xs" onClick={() => set({ tour: tour - 1 })}>{L('Trước', 'Back')}</button>}
          <button autoFocus className="btn btn-primary h-8 text-xs" onClick={() => (tour === TOUR.length - 1 ? end() : set({ tour: tour + 1 }))}>{tour === TOUR.length - 1 ? L('Xong', 'Done') : L('Tiếp', 'Next')}</button>
        </div>
      </div>
    </>
  )
}
