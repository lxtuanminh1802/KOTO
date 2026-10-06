import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { api, ApiError, setSession, type Session } from '../lib/api'
import { useT } from '../lib/i18n'
import { useUI } from '../lib/store'
import { FieldError, Icon } from '../components/ui'

/** UR-AUTH-01: password, then a 6-digit OTP from an authenticator app (enrolled on first sign-in). */
export default function Login() {
  const { L, lang } = useT()
  const set = useUI(s => s.set)
  const [step, setStep] = useState<'password' | 'otp'>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState('')
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null)
  const [qr, setQr] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    api<{ demo_mode: boolean }>('/api/health').then(h => setDemo(h.demo_mode)).catch(() => {})
  }, [])
  useEffect(() => {
    if (enroll) QRCode.toDataURL(enroll.uri, { margin: 1, width: 176 }).then(setQr)
  }, [enroll])

  const fail = (e: unknown) => setErr(e instanceof ApiError ? e.msg(lang) : L('Không kết nối được máy chủ.', 'Cannot reach the server.'))

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await api<{ pending: string; enroll?: { secret: string; uri: string } }>('/api/auth/login', { body: { username, password } })
      setPending(r.pending)
      setEnroll(r.enroll || null)
      setStep('otp')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!/^\d{6}$/.test(code)) return setErr(L('Mã xác thực gồm 6 chữ số.', 'The code has 6 digits.'))
    setBusy(true)
    try {
      const s = await api<Session>('/api/auth/otp', { body: { pending, code } })
      setSession(s)
    } catch (e) {
      fail(e)
      if (e instanceof ApiError && (e.code === 'auth.pending_expired' || e.code === 'auth.locked')) setStep('password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-full overflow-y-auto grid place-items-center p-4 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="inline-flex h-10 px-2 rounded-md bg-white ring-1 ring-line items-center"><img src="/aipt-logo.png" alt="AIPT Group" className="h-8 w-auto" /></span>
          <button className="btn btn-ghost h-8 text-xs" onClick={() => set({ lang: lang === 'vi' ? 'en' : 'vi' })}><Icon name="globe" />{lang === 'vi' ? 'English' : 'Tiếng Việt'}</button>
        </div>
        <div className="panel p-6 sm:p-8 shadow-xl">
          <p className="text-[15px] font-bold tracking-tight">Video Master <span className="text-accent">AI</span></p>
          <h1 className="text-xl font-bold mt-4">{step === 'password' ? L('Đăng nhập', 'Sign in') : L('Xác thực 2 lớp', 'Two-factor verification')}</h1>
          <p className="text-sm text-muted mt-1">
            {step === 'password'
              ? L('Chỉ người được cấp quyền mới truy cập chứng cứ.', 'Only authorised users may access evidence.')
              : enroll
                ? L('Lần đầu đăng nhập: quét mã bằng ứng dụng xác thực rồi nhập mã 6 số.', 'First sign-in: scan the code with your authenticator app, then enter the 6-digit code.')
                : L('Nhập mã 6 số từ ứng dụng xác thực hoặc thiết bị do đơn vị cấp.', 'Enter the 6-digit code from your authenticator app or unit-issued device.')}
          </p>
          {step === 'password' ? (
            <form className="mt-6 space-y-4" onSubmit={submitPassword} noValidate>
              <label className="block"><span className="label">{L('Tên đăng nhập', 'Username')}</span>
                <input className="inp mt-1.5" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus /></label>
              <label className="block"><span className="label">{L('Mật khẩu', 'Password')}</span>
                <input className="inp mt-1.5" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
              <FieldError msg={err} />
              <button className="btn btn-primary w-full h-10" disabled={busy || !username || !password}>{busy ? <Icon name="loader" /> : <Icon name="lock" />}{L('Tiếp tục', 'Continue')}</button>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={submitOtp} noValidate>
              {enroll && (
                <div className="flex gap-4 items-center p-3 rounded-lg bg-subtle/70 ring-1 ring-line">
                  {qr ? <img src={qr} alt="QR" className="w-28 h-28 rounded bg-white p-1" /> : <div className="w-28 h-28 shimmer rounded" />}
                  <div className="min-w-0 text-xs text-muted">{L('Hoặc nhập khóa', 'Or enter the key')}<p className="font-mono text-fg break-all mt-1">{enroll.secret}</p></div>
                </div>
              )}
              <label className="block"><span className="label">{L('Mã xác thực', 'Verification code')}</span>
                <input className="inp mt-1.5 h-11 text-center font-mono text-lg tracking-[.5em]" inputMode="numeric" maxLength={6} autoComplete="one-time-code" autoFocus
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
              <FieldError msg={err} />
              <button className="btn btn-primary w-full h-10" disabled={busy}>{busy ? <Icon name="loader" /> : <Icon name="shield-check" />}{L('Xác thực và vào hệ thống', 'Verify and continue')}</button>
              <button type="button" className="btn btn-ghost w-full h-8 text-xs" onClick={() => { setStep('password'); setCode(''); setErr('') }}>{L('Quay lại', 'Back')}</button>
            </form>
          )}
        </div>
        {demo && (
          <p className="text-[11px] text-muted mt-4 leading-5">
            {L('Chế độ demo: tài khoản tranhai, phamthuha, nguyenvanduc, leminh, viewer, admin · mật khẩu VideoMaster@2026 · mã OTP 000000 · PIN 123456.',
              'Demo mode: accounts tranhai, phamthuha, nguyenvanduc, leminh, viewer, admin · password VideoMaster@2026 · OTP 000000 · PIN 123456.')}
          </p>
        )}
      </div>
    </div>
  )
}
