import { useEffect, useRef, useState, type FormEvent } from 'react'
import { STUDENT_ID_RE, login, type SessionUser } from '../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onLoggedIn: (user: SessionUser) => void
}

/** 首次进入作业页前的登录框：姓名 + 10 位学号；管理员学号会多一步口令。 */
export default function LoginDialog({ open, onClose, onLoggedIn }: Props) {
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [needPassword, setNeedPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) window.setTimeout(() => nameRef.current?.focus(), 350)
  }, [open])

  useEffect(() => {
    if (needPassword) pwRef.current?.focus()
  }, [needPassword])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  const idValid = STUDENT_ID_RE.test(studentId)

  // 输入框下不放常驻提示；点“进入”时才校验，不合格就在下方错误行说明原因，且不放行
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setTouched(true)
    if (!name.trim()) return setError('请填写姓名')
    if (!idValid) return setError('学号须为 10 位数字')
    if (needPassword && !password) return setError('请输入管理员口令')
    setBusy(true)
    setError(null)
    try {
      const r = await login({ name: name.trim(), studentId, password: needPassword ? password : undefined })
      if (r.needPassword) {
        setNeedPassword(true)
        return
      }
      if (r.user) onLoggedIn(r.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后再试')
      if ((err as { needPassword?: boolean }).needPassword) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center px-4 transition-[opacity,visibility] duration-500"
      style={{ opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden' }}
      inert={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-title"
    >
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default bg-black/45" onClick={() => !busy && onClose()} tabIndex={-1} />
      <form
        onSubmit={submit}
        noValidate
        className="liquid-glass relative w-full max-w-sm rounded-[1.75rem] px-6 py-8 text-white transition-transform duration-500 sm:px-8"
        style={{ transform: open ? 'none' : 'translateY(16px) scale(0.98)', backgroundColor: 'rgb(10 14 22 / 0.55)' }}
      >
        <p className="text-xs tracking-[0.3em] text-white/45">作业箱</p>
        <h2 id="login-title" className="mt-3 font-headline text-3xl">
          {needPassword ? '管理员验证' : '先认识一下你'}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          {needPassword ? '这个学号是管理员，请输入管理员口令。' : '首次进入请填写姓名和学号，之后 30 天内免登录。'}
        </p>

        <label className="mt-7 block">
          <span className="text-xs text-white/50">姓名</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoComplete="off"
            disabled={needPassword}
            className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-base outline-none placeholder:text-white/25 focus:border-white/60 disabled:opacity-50"
          />
        </label>

        <label className="mt-5 block">
          <span className="text-xs text-white/50">学号</span>
          <input
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value.replace(/\s/g, '').slice(0, 20))
              setTouched(false)
              setError(null)
            }}
            inputMode="numeric"
            autoComplete="off"
            disabled={needPassword}
            aria-invalid={touched && !idValid}
            className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-base tracking-[0.12em] tabular-nums outline-none placeholder:tracking-normal placeholder:text-white/25 focus:border-white/60 disabled:opacity-50 aria-[invalid=true]:border-rose-300/70"
          />
        </label>

        {needPassword && (
          <label className="mt-5 block">
            <span className="text-xs text-white/50">管理员口令</span>
            <input
              ref={pwRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-base outline-none focus:border-white/60"
            />
          </label>
        )}

        <p role="alert" className="mt-4 min-h-[1.25rem] text-sm text-rose-300">
          {error}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (needPassword) {
                setNeedPassword(false)
                setPassword('')
                setError(null)
              } else onClose()
            }}
            disabled={busy}
            className="cursor-pointer text-sm text-white/50 hover:text-white disabled:opacity-40"
          >
            {needPassword ? '换个学号' : '取消'}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="cursor-pointer rounded-full bg-white px-6 py-2.5 text-sm font-medium text-[#0d1520] transition-[background-color,transform,opacity] hover:bg-white/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '请稍候…' : needPassword ? '验证' : '进入'}
          </button>
        </div>
      </form>
    </div>
  )
}
