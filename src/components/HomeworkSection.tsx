import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import {
  MAX_FILE_BYTES,
  createHomework,
  editHomework,
  fileKind,
  formatBytes,
  formatDate,
  removeHomework,
  storageLabel,
  type AttachmentMeta,
  type Homework,
} from '../lib/homework'
import { downloadHref } from '../lib/api'

const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治']

interface Props {
  headingRef?: RefObject<HTMLHeadingElement | null>
  mood: string
  homework: Homework[]
  loading: boolean
  error: string | null
  onReload: () => void
  onCreated: (hw: Homework) => void
  onUpdated: (hw: Homework) => void
  onRemoved: (id: string) => void
}

export default function HomeworkSection({ headingRef, mood, homework, loading, error, onReload, onCreated, onUpdated, onRemoved }: Props) {
  const [composing, setComposing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <section id="homework" className="anchor-section relative px-4 pt-24 pb-24 sm:px-8 sm:pt-32 sm:pb-32">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-8 border-b border-white/10 pb-10 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="text-xs tracking-[0.3em] text-white/45">作业箱</p>
            <h2 ref={headingRef} tabIndex={-1} className="mt-4 font-headline text-4xl leading-tight outline-none sm:text-5xl">
              查看作业
            </h2>
            <p className="mt-5 leading-[1.9] text-white/60">
              每一份作业都是一张安静的卡片：科目、逐项内容与附件。布置之后，所有打开作业箱的人都能看到。
            </p>
            {mood && (
              <p className="mt-4 text-sm text-white/50">
                此刻心境：<span className="text-white/80">{mood}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-xs text-emerald-200/80"
              title="作业与附件保存在班级服务器上，所有打开本页的人都能看到"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              {storageLabel}
            </span>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="liquid-glass cursor-pointer rounded-full px-4 py-2 text-sm text-white/80 transition hover:text-white disabled:opacity-50"
            >
              {loading ? '同步中…' : '刷新'}
            </button>
            <button
              type="button"
              onClick={() => setComposing(true)}
              disabled={composing}
              className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-[#0d1520] transition hover:bg-white/90 active:scale-[0.97] disabled:cursor-default disabled:opacity-40"
            >
              <span aria-hidden="true" className="text-base leading-none">＋</span>
              布置作业
            </button>
          </div>
        </header>

        {error && (
          <p role="alert" className="mt-8 rounded-2xl bg-rose-400/10 px-5 py-4 text-sm leading-relaxed text-rose-200">
            {error}
          </p>
        )}

        <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {composing && (
            <Composer
              onCancel={() => setComposing(false)}
              onDone={(hw) => {
                setComposing(false)
                onCreated(hw)
              }}
            />
          )}
          {homework.map((hw, i) =>
            hw.id === editingId ? (
              <Composer
                key={hw.id}
                initial={hw}
                onCancel={() => setEditingId(null)}
                onDone={(updated) => {
                  setEditingId(null)
                  onUpdated(updated)
                }}
              />
            ) : (
              <HomeworkCard
                key={hw.id}
                hw={hw}
                index={i}
                onEdit={editingId ? undefined : () => setEditingId(hw.id)}
                onRemoved={onRemoved}
              />
            ),
          )}
        </div>

        {!loading && !error && homework.length === 0 && !composing && (
          <div className="mt-4 flex flex-col items-center py-16 text-center">
            <p className="font-headline text-2xl text-white/80">此处安静无声</p>
            <p className="mt-3 text-sm text-white/45">还没有作业。点击“布置作业”，写下第一份。</p>
          </div>
        )}
        {loading && homework.length === 0 && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-3xl bg-white/[0.03]" />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function HomeworkCard({
  hw,
  index,
  onEdit,
  onRemoved,
}: {
  hw: Homework
  index: number
  /** Absent while another card is being edited. */
  onEdit?: () => void
  onRemoved: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setErr(null)
    try {
      await removeHomework(hw)
      onRemoved(hw.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败')
      setBusy(false)
    }
  }

  return (
    <article
      className="liquid-glass liquid-glass-card rise-in flex flex-col rounded-3xl p-6 sm:p-7"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-headline text-2xl">{hw.subject}</h3>
          <p className="mt-1.5 text-xs text-white/45">
            {formatDate(hw.createdAt)}
            {hw.author && <> · {hw.author}</>}
            {hw.updatedAt && <span title={`修改于 ${formatDate(hw.updatedAt)}`}> · 已修改</span>}
          </p>
        </div>
        {hw.due && (
          <span className="shrink-0 rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/75">截止 {hw.due.replace(/^\d{4}-/, '').replace('-', '/')}</span>
        )}
      </header>

      <ol className="mt-5 space-y-2.5 text-[0.95rem] leading-relaxed text-white/85">
        {hw.items.map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-5 shrink-0 text-right text-white/40 tabular-nums">{i + 1}.</span>
            <span className="min-w-0 break-words whitespace-pre-wrap">{item}</span>
          </li>
        ))}
      </ol>

      {hw.files.length > 0 && (
        <ul className="mt-6 space-y-2 border-t border-white/10 pt-5">
          {hw.files.map((f, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className="w-12 shrink-0 truncate rounded-md bg-white/[0.07] px-1.5 py-1 text-center text-[0.62rem] tracking-wider text-white/70">
                {fileKind(f)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-white/85" title={f.name}>
                  {f.name}
                </span>
                <span className="text-xs text-white/40">
                  {formatBytes(f.size)}
                  {!f.key && ' · 仅记录信息，未上传'}
                </span>
              </span>
              {f.key && (
                <a
                  href={downloadHref(f.key, f.name)}
                  className="shrink-0 rounded-full px-3 py-1 text-xs text-white/70 transition hover:bg-white/10 hover:text-white"
                  rel="noopener"
                >
                  下载
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Everyone can edit or delete any card — no login by design. */}
      <footer className="mt-auto flex items-center justify-end gap-2 pt-6 text-xs">
        {err && <span className="mr-auto text-rose-300">{err}</span>}
        {confirming ? (
          <>
            <button type="button" onClick={() => setConfirming(false)} className="cursor-pointer rounded-full px-3 py-1 text-white/55 hover:text-white">
              取消
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="cursor-pointer rounded-full bg-rose-400/15 px-3 py-1 text-rose-200 hover:bg-rose-400/25 disabled:opacity-50"
            >
              {busy ? '删除中…' : '确认删除'}
            </button>
          </>
        ) : (
          <>
            {onEdit && (
              <button type="button" onClick={onEdit} className="cursor-pointer rounded-full px-3 py-1 text-white/55 hover:bg-white/10 hover:text-white">
                修改
              </button>
            )}
            <button type="button" onClick={() => setConfirming(true)} className="cursor-pointer rounded-full px-3 py-1 text-white/40 hover:text-white/80">
              删除
            </button>
          </>
        )}
      </footer>
    </article>
  )
}

/* ------------------------------------------------------------------ */

/** New homework, or — with `initial` — edit an existing card in place. */
function Composer({ initial, onCancel, onDone }: { initial?: Homework; onCancel: () => void; onDone: (hw: Homework) => void }) {
  const editing = !!initial
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [items, setItems] = useState<string[]>(initial?.items.length ? initial.items : [''])
  const [due, setDue] = useState(initial?.due ?? '')
  const [author, setAuthor] = useState(initial?.author ?? '')
  /** Attachments already on the card that are being kept (edit mode). */
  const [keep, setKeep] = useState<AttachmentMeta[]>(initial?.files ?? [])
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [progress, setProgress] = useState<{ index: number; ratio: number; attempt: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const itemRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const focusIndex = useRef<number | null>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    subjectRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (focusIndex.current !== null) {
      itemRefs.current[focusIndex.current]?.focus()
      focusIndex.current = null
    }
  }, [items])

  const setItem = (i: number, v: string) => setItems((prev) => prev.map((x, j) => (j === i ? v : x)))

  const addItemAfter = (i: number, value = '') => {
    focusIndex.current = i + 1
    setItems((prev) => [...prev.slice(0, i + 1), value, ...prev.slice(i + 1)])
  }

  const removeItem = (i: number) => {
    focusIndex.current = Math.max(0, i - 1)
    setItems((prev) => (prev.length === 1 ? [''] : prev.filter((_, j) => j !== i)))
  }

  const onItemKey = (i: number, e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      addItemAfter(i)
    } else if (e.key === 'Backspace' && items[i] === '' && items.length > 1) {
      e.preventDefault()
      removeItem(i)
    }
  }

  // Pasting "1. xxx\n2. yyy" splits into separate items.
  const onItemPaste = (i: number, e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text')
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(\d+[.、．)）]|[-*•])\s*/, '').trim())
      .filter(Boolean)
    if (lines.length < 2) return
    e.preventDefault()
    focusIndex.current = i + lines.length - 1
    setItems((prev) => {
      const head = prev[i] ? [prev[i], ...lines] : lines
      return [...prev.slice(0, i), ...head, ...prev.slice(i + 1)]
    })
  }

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

  const cleanItems = items.map((s) => s.trim()).filter(Boolean)
  const ready = subject.trim().length > 0 && cleanItems.length > 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!subject.trim()) {
      setError('请填写科目')
      subjectRef.current?.focus()
      return
    }
    if (cleanItems.length === 0) {
      setError('请至少填写一项作业内容')
      itemRefs.current[0]?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const report = (index: number, ratio: number, attempt: number) => setProgress({ index, ratio, attempt })
      const hw = initial
        ? await editHomework(initial, { subject, items: cleanItems, due, author, keep, files }, report)
        : await createHomework({ subject, items: cleanItems, due, author, files }, report)
      onDone(hw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败，请稍后再试'
      setError(files.length > 0 ? `${msg}（本次已上传的附件已回滚，可直接重试）` : msg)
      setSubmitting(false)
      setProgress(null)
    }
  }

  const overall =
    progress && files.length ? Math.round(((progress.index + progress.ratio) / files.length) * 100) : null

  return (
    <form
      ref={cardRef}
      onSubmit={submit}
      className="liquid-glass liquid-glass-card rise-in flex flex-col rounded-3xl p-6 sm:p-7 md:col-span-2 lg:col-span-2"
      aria-label={editing ? '修改作业' : '布置新作业'}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs tracking-[0.3em] text-white/45">{editing ? '修改作业' : '新作业'}</p>
        <button type="button" onClick={onCancel} disabled={submitting} className="cursor-pointer text-sm text-white/45 hover:text-white disabled:opacity-40">
          取消
        </button>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="text-xs text-white/50">科目</span>
          <input
            ref={subjectRef}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={20}
            placeholder="例如：数学"
            className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 font-headline text-2xl outline-none placeholder:text-white/25 focus:border-white/60"
          />
        </label>
        <label className="block">
          <span className="text-xs text-white/50">截止日期（可选）</span>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-sm text-white/85 outline-none [color-scheme:dark] focus:border-white/60 sm:w-40"
          />
        </label>
        <label className="block">
          <span className="text-xs text-white/50">布置人（可选）</span>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            maxLength={20}
            placeholder="例如：王老师"
            className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-sm outline-none placeholder:text-white/25 focus:border-white/60 sm:w-36"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {SUBJECTS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSubject(s)}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs transition ${
              subject === s ? 'bg-white text-[#0d1520]' : 'bg-white/[0.05] text-white/65 hover:bg-white/10 hover:text-white'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <fieldset className="mt-7">
        <legend className="text-xs text-white/50">
          作业内容 <span className="text-white/30">· 回车新增一项，可直接粘贴多行</span>
        </legend>
        <ol className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="group flex items-start gap-3">
              <span className="w-6 shrink-0 pt-2 text-right text-sm text-white/40 tabular-nums">{i + 1}.</span>
              <textarea
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                rows={1}
                value={item}
                onChange={(e) => {
                  setItem(i, e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${e.target.scrollHeight}px`
                }}
                onKeyDown={(e) => onItemKey(i, e)}
                onPaste={(e) => onItemPaste(i, e)}
                placeholder={i === 0 ? '例如：完成课本第 42 页练习 1–6' : '下一项…'}
                aria-label={`第 ${i + 1} 项`}
                className="min-w-0 flex-1 resize-none rounded-xl bg-white/[0.03] px-3 py-2 text-[0.95rem] leading-relaxed outline-none placeholder:text-white/25 focus:bg-white/[0.06]"
              />
              <button
                type="button"
                onClick={() => removeItem(i)}
                aria-label={`删除第 ${i + 1} 项`}
                className="mt-1.5 cursor-pointer rounded-full px-2 py-1 text-white/30 transition hover:text-white/80 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => addItemAfter(items.length - 1)}
          className="mt-3 ml-9 cursor-pointer text-sm text-white/55 hover:text-white"
        >
          ＋ 添加一项
        </button>
      </fieldset>

      <div className="mt-7">
        <span className="text-xs text-white/50">附件（可选，任意格式）</span>
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-center text-sm transition ${
            dragging ? 'border-white/60 bg-white/[0.06]' : 'border-white/15 hover:border-white/35'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <span className="text-white/75">点击选择或拖入文件</span>
          <span className="mt-1 text-xs text-white/40">
            {`上传到班级服务器 · 单个不超过 ${formatBytes(MAX_FILE_BYTES)}`}
          </span>
        </label>
        {keep.length > 0 && (
          <ul className="mt-3 space-y-2" aria-label="已有附件">
            {keep.map((f) => (
              <li key={f.key ?? f.name} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                <span className="w-12 shrink-0 truncate text-center text-[0.62rem] tracking-wider text-white/60">{fileKind(f)}</span>
                <span className="min-w-0 flex-1 truncate text-white/85" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-xs text-white/40">已上传 · {formatBytes(f.size)}</span>
                {!submitting && (
                  <button
                    type="button"
                    onClick={() => setKeep((prev) => prev.filter((x) => x !== f))}
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
        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((f, i) => (
              <li key={`${f.name}:${f.size}`} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                <span className="w-12 shrink-0 truncate text-center text-[0.62rem] tracking-wider text-white/60">{fileKind(f)}</span>
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
                {!submitting && (
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
      </div>

      {error && (
        <p role="alert" className="mt-5 text-sm text-rose-300">
          {error}
        </p>
      )}

      <div className="mt-7 flex items-center justify-end gap-4 border-t border-white/10 pt-5">
        {overall !== null && (
          <div className="mr-auto flex items-center gap-3 text-xs text-white/55">
            <span className="h-1 w-24 overflow-hidden rounded-full bg-white/10 sm:w-40">
              <span className="block h-full bg-white/80 transition-[width]" style={{ width: `${overall}%` }} />
            </span>
            上传中 {overall}%{progress && progress.attempt > 1 ? ` · 第 ${progress.attempt} 次尝试` : ''}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className={`cursor-pointer rounded-full bg-white px-6 py-2.5 text-sm font-medium text-[#0d1520] transition hover:bg-white/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${ready ? '' : 'opacity-60'}`}
        >
          {submitting ? '保存中…' : editing ? '保存修改' : '发布作业'}
        </button>
      </div>
    </form>
  )
}
