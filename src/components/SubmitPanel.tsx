import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { fetchMySubmission, submitHomework, type Submission } from '../lib/api'
import { MAX_FILE_BYTES, fileKind, formatBytes, formatDate } from '../lib/homework'

/** 收作业卡片底部的“交作业”区：显示自己的提交状态，可提交 / 重新提交。 */
export default function SubmitPanel({ cardId, due }: { cardId: string; due?: string }) {
  const [mine, setMine] = useState<Submission | null | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ index: number; ratio: number; attempt: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [justDone, setJustDone] = useState(false)

  useEffect(() => {
    let alive = true
    fetchMySubmission(cardId)
      .then((s) => alive && setMine(s))
      .catch(() => alive && setMine(null))
    return () => {
      alive = false
    }
  }, [cardId])

  // 打开卡片那一刻是否已过截止（北京时间当天 23:59:59），只用于提示文案
  const [pastDue] = useState(() => !!due && Date.now() > Date.parse(`${due}T23:59:59+08:00`))

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list)
    const tooBig = incoming.filter((f) => f.size > MAX_FILE_BYTES)
    setError(tooBig.length ? `单个文件不能超过 ${formatBytes(MAX_FILE_BYTES)}：${tooBig.map((f) => f.name).join('、')}` : null)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`))
      return [...prev, ...incoming.filter((f) => f.size <= MAX_FILE_BYTES && !seen.has(`${f.name}:${f.size}`))]
    })
  }, [])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
  }

  const submit = async () => {
    if (!files.length) {
      setError('请先选择要提交的文件')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const s = await submitHomework(cardId, files, (index, ratio, attempt) => setProgress({ index, ratio, attempt }))
      setMine(s)
      setFiles([])
      setOpen(false)
      setJustDone(true)
      window.setTimeout(() => setJustDone(false), 4000)
    } catch (err) {
      setError(`${err instanceof Error ? err.message : '提交失败'}（本次已上传的文件已回滚，可直接重试）`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const overall = progress && files.length ? Math.round(((progress.index + progress.ratio) / files.length) * 100) : null

  return (
    <div className="mt-6 border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs tracking-[0.2em] text-white/45">交作业</span>
        {mine === undefined ? (
          <span className="text-xs text-white/35">读取中…</span>
        ) : mine ? (
          <span className={`text-xs ${justDone ? 'text-emerald-200' : 'text-white/65'}`}>
            {justDone ? '提交成功 · ' : '已提交 · '}
            {formatDate(mine.submittedAt)} · {mine.files.length} 个文件
            {mine.late && <span className="ml-1.5 rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-200">迟交</span>}
          </span>
        ) : (
          <span className="text-xs text-white/45">{pastDue ? '未提交 · 已过截止时间，现在提交会记为迟交' : '未提交'}</span>
        )}
        {!open && mine !== undefined && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto cursor-pointer rounded-full bg-white px-4 py-1.5 text-xs font-medium text-[#0d1520] transition-[background-color,transform] hover:bg-white/90 active:scale-[0.97]"
          >
            {mine ? '重新提交' : '交作业'}
          </button>
        )}
      </div>

      {mine && !open && (
        <ul className="mt-3 space-y-1">
          {mine.files.map((f) => (
            <li key={f.key} className="flex items-center gap-2 text-xs text-white/50">
              <span className="w-10 shrink-0 truncate text-[0.6rem] tracking-wider text-white/40">{fileKind(f)}</span>
              <span className="min-w-0 flex-1 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-4">
          {mine && <p className="mb-3 text-xs leading-relaxed text-white/45">重新提交后以这一次为准（之前的提交管理员那里仍有保留）。</p>}
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center text-sm transition-colors ${
              dragging ? 'border-white/60 bg-white/[0.06]' : 'border-white/15 hover:border-white/35'
            }`}
          >
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
            <span className="text-white/75">点击选择或拖入文件</span>
            <span className="mt-1 text-xs text-white/40">任意格式 · 单个不超过 {formatBytes(MAX_FILE_BYTES)}</span>
          </label>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((f, i) => (
                <li key={`${f.name}:${f.size}`} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                  <span className="w-10 shrink-0 truncate text-center text-[0.6rem] tracking-wider text-white/60">{fileKind(f)}</span>
                  <span className="min-w-0 flex-1 truncate text-white/85" title={f.name}>
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs text-white/40">
                    {progress && progress.index === i
                      ? progress.attempt > 1
                        ? `重试中（第 ${progress.attempt} 次）`
                        : `${Math.round(progress.ratio * 100)}%`
                      : progress && progress.index > i
                        ? '已上传'
                        : formatBytes(f.size)}
                  </span>
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`移除 ${f.name}`}
                      className="cursor-pointer px-1 text-white/35 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-rose-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-end gap-3">
            {overall !== null && (
              <span className="mr-auto flex items-center gap-2 text-xs text-white/55">
                <span className="h-1 w-20 overflow-hidden rounded-full bg-white/10">
                  <span className="block h-full bg-white/80 transition-[width]" style={{ width: `${overall}%` }} />
                </span>
                {overall}%
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setFiles([])
                setError(null)
              }}
              disabled={busy}
              className="cursor-pointer text-xs text-white/50 hover:text-white disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="cursor-pointer rounded-full bg-white px-5 py-2 text-xs font-medium text-[#0d1520] transition-[background-color,transform,opacity] hover:bg-white/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? '提交中…' : '确认提交'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
