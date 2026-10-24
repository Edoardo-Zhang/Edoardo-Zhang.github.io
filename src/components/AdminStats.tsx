import { useEffect, useMemo, useState } from 'react'
import { adminFileHref, adminImageViewHref, fetchAdminStats, unbindStudent, type AdminStats as Stats, type StatsCard } from '../lib/api'
import { formatBytes, formatDate, isImageFile } from '../lib/homework'
import ImageViewer, { type ViewerImage } from './ImageViewer'

type Tab = 'submitted' | 'missing' | 'late'

/**
 * 作业统计：页面角落一个不起眼的小图标。权限由服务器判断——
 * 非管理员点击时服务器返回“暂无权限”，这里只负责把它显示出来。
 */
export default function AdminStats() {
  const [toast, setToast] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)
  const [cardId, setCardId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('submitted')
  const [query, setQuery] = useState('')

  const load = async (fromButton: boolean) => {
    setLoading(true)
    try {
      const s = await fetchAdminStats()
      setStats(s)
      setCardId((prev) => (prev && s.cards.some((c) => c.id === prev) ? prev : (s.cards[0]?.id ?? null)))
      setOpen(true)
    } catch (err) {
      if (fromButton) {
        setToast(err instanceof Error ? err.message : '暂无权限')
        window.setTimeout(() => setToast(null), 2200)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const card = stats?.cards.find((c) => c.id === cardId) ?? null

  return (
    <>
      <button
        type="button"
        onClick={() => void load(true)}
        aria-label="作业统计"
        title="作业统计"
        className="cursor-pointer rounded-full p-1.5 text-white/25 transition-colors hover:text-white/60"
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M5 20V11M12 20V5M19 20v-6" />
        </svg>
      </button>

      {toast && (
        <div role="status" className="fixed bottom-8 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-white/10 bg-[#1b2230] px-4 py-2 text-sm text-white/90 shadow-lg">
          {toast}
        </div>
      )}

      {open && stats && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="作业统计">
          <button type="button" aria-label="关闭" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/55" onClick={() => setOpen(false)} />
          <div
            className="liquid-glass relative flex max-h-[92svh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[1.75rem] text-white sm:rounded-[1.75rem]"
            style={{ backgroundColor: 'rgb(8 12 20 / 0.82)' }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 pt-6 pb-4 sm:px-8">
              <div>
                <p className="text-xs tracking-[0.3em] text-white/45">管理员</p>
                <h2 className="mt-2 font-headline text-3xl">作业统计</h2>
                <p className="mt-2 text-xs text-white/45">
                  名单来自登录过的同学，共 {stats.rosterSize} 人 · 更新于 {formatDate(stats.generatedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void load(false)} disabled={loading} className="cursor-pointer rounded-full px-3 py-1.5 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40">
                  {loading ? '刷新中…' : '刷新'}
                </button>
                <button type="button" onClick={() => setOpen(false)} aria-label="关闭统计" className="cursor-pointer rounded-full px-3 py-1.5 text-lg leading-none text-white/60 hover:bg-white/10 hover:text-white">
                  ×
                </button>
              </div>
            </header>

            {stats.cards.length === 0 ? (
              <p className="px-8 py-16 text-center text-sm text-white/50">还没有开启“收作业”的卡片。布置或修改作业时打开“开启收作业”即可。</p>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                <nav aria-label="收作业卡片" className="flex shrink-0 gap-2 overflow-x-auto border-b border-white/10 px-5 py-3 sm:w-60 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-b-0 sm:px-3 sm:py-4">
                  {stats.cards.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCardId(c.id)}
                      className={`shrink-0 cursor-pointer rounded-2xl px-4 py-3 text-left transition-colors ${c.id === cardId ? 'bg-white/10' : 'hover:bg-white/[0.05]'}`}
                    >
                      <span className="block truncate text-sm">{c.subject}</span>
                      <span className="mt-1 block text-xs text-white/45">
                        {c.submitted.length}/{stats.rosterSize} 已交{c.lateCount ? ` · ${c.lateCount} 迟交` : ''}
                      </span>
                    </button>
                  ))}
                </nav>
                {card && <CardDetail card={card} rosterSize={stats.rosterSize} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onChanged={() => void load(false)} />}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function CardDetail({
  card,
  rosterSize,
  tab,
  setTab,
  query,
  setQuery,
  onChanged,
}: {
  card: StatsCard
  rosterSize: number
  tab: Tab
  setTab: (t: Tab) => void
  query: string
  setQuery: (q: string) => void
  onChanged: () => void
}) {
  const [viewer, setViewer] = useState<{ images: ViewerImage[]; index: number } | null>(null)
  const pct = rosterSize ? Math.round((card.submitted.length / rosterSize) * 100) : 0
  const q = query.trim()
  const match = (r: { name: string; studentId: string }) => !q || r.name.includes(q) || r.studentId.includes(q)
  const late = useMemo(() => card.submitted.filter((s) => s.late), [card])

  const exportCsv = () => {
    const rows = [['学号', '姓名', '状态', '提交时间', '是否迟交', '提交次数', '文件']]
    for (const s of card.submitted) rows.push([s.studentId, s.name, '已交', new Date(s.submittedAt).toLocaleString('zh-CN'), s.late ? '是' : '否', String(s.versions), s.files.map((f) => f.name).join('; ')])
    for (const m of card.missing) rows.push([m.studentId, m.name, '未交', '', '', '0', ''])
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    // 带 BOM，Excel 直接打开不乱码；学号前加制表符避免被当成数字科学计数
    const blob = new Blob(['﻿' + csv.replace(/"(\d{10})"/g, '"\t$1"')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${card.subject}-提交情况.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const unbind = async (sid: string, name: string) => {
    if (!window.confirm(`解除 ${name}（${sid}）的姓名绑定？\n解除后此学号下次可用新的姓名登录，已交的作业不受影响。`)) return
    try {
      await unbindStudent(sid)
      onChanged()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '操作失败')
    }
  }

  const tabs: [Tab, string, number][] = [
    ['submitted', '已交', card.submitted.length],
    ['missing', '未交', card.missing.length],
    ['late', '迟交', late.length],
  ]

  return (
    <section className="flex min-h-0 flex-1 flex-col px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-headline text-2xl">{card.subject}</h3>
        <span className="text-xs text-white/45">{card.due ? `截止 ${card.due}` : '未设截止日期'}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full bg-emerald-300/80" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-sm tabular-nums text-white/80">
          {card.submitted.length} / {rosterSize}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {tabs.map(([t, label, n]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`cursor-pointer rounded-full px-3 py-1 text-xs transition-colors ${tab === t ? 'bg-white text-[#0d1520]' : 'bg-white/[0.06] text-white/70 hover:bg-white/10'}`}
          >
            {label} {n}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜姓名或学号"
          className="ml-auto w-36 rounded-full bg-white/[0.06] px-3 py-1 text-xs outline-none placeholder:text-white/35 focus:bg-white/10 sm:w-44"
        />
        <button type="button" onClick={exportCsv} className="cursor-pointer rounded-full px-3 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white">
          导出 CSV
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pb-4">
        {tab === 'missing' ? (
          <ul className="divide-y divide-white/[0.06]">
            {card.missing.filter(match).map((m) => (
              <li key={m.studentId} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-28 shrink-0 tabular-nums text-white/50">{m.studentId}</span>
                <span className="flex-1">{m.name}</span>
                <button type="button" onClick={() => void unbind(m.studentId, m.name)} className="cursor-pointer text-xs text-white/30 hover:text-white/70">
                  解除绑定
                </button>
              </li>
            ))}
            {card.missing.filter(match).length === 0 && <li className="py-8 text-center text-sm text-white/45">{q ? '没有匹配的同学' : '所有登录过的同学都交了'}</li>}
          </ul>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {(tab === 'late' ? late : card.submitted).filter(match).map((s) => (
              <li key={s.studentId} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-28 shrink-0 tabular-nums text-white/50">{s.studentId}</span>
                  <span>{s.name}</span>
                  {s.late && <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs text-amber-200">迟交</span>}
                  <span className="ml-auto text-xs text-white/45">
                    {formatDate(s.submittedAt)}
                    {s.versions > 1 && ` · 第 ${s.versions} 次提交`}
                  </span>
                </div>
                {s.files.some((f) => isImageFile(f)) && (
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-0 sm:pl-[7.75rem]">
                    {s.files.filter((f) => isImageFile(f)).map((f, i, arr) => (
                      <button
                        key={f.key}
                        type="button"
                        title={f.name}
                        aria-label={`查看图片：${f.name}`}
                        onClick={() =>
                          setViewer({
                            index: i,
                            images: arr.map((x) => ({ name: `${s.name} · ${x.name}`, src: adminImageViewHref(x.key, x.name, 'full'), downloadHref: adminFileHref(x.key, x.name) })),
                          })
                        }
                        className="h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg bg-white/[0.06]"
                      >
                        <img src={adminImageViewHref(f.key, f.name, 'thumb')} alt={f.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                <ul className="mt-1.5 space-y-1 pl-0 sm:pl-[7.75rem]">
                  {s.files.filter((f) => !isImageFile(f)).map((f) => (
                    <li key={f.key} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-white/70" title={f.name}>
                        {f.name}
                      </span>
                      <span className="shrink-0 text-white/35">{formatBytes(f.size)}</span>
                      <a href={adminFileHref(f.key, f.name)} className="shrink-0 rounded-full px-2 py-0.5 text-white/60 hover:bg-white/10 hover:text-white">
                        下载
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
            {(tab === 'late' ? late : card.submitted).filter(match).length === 0 && (
              <li className="py-8 text-center text-sm text-white/45">{q ? '没有匹配的同学' : tab === 'late' ? '没有迟交' : '还没有人提交'}</li>
            )}
          </ul>
        )}
      </div>
      {viewer && <ImageViewer images={viewer.images} index={viewer.index} onClose={() => setViewer(null)} />}
    </section>
  )
}
