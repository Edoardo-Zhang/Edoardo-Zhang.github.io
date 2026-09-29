import { useCallback, useEffect, useRef, useState } from 'react'
import Hero from './components/Hero'
import HomeworkSection from './components/HomeworkSection'
import { loadHomework, storageMode, type Homework } from './lib/homework'

type View = 'hero' | 'homework'

const viewFromHash = (): View => (location.hash.replace('#', '') === 'homework' ? 'homework' : 'hero')
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function App() {
  const [homework, setHomework] = useState<Homework[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mood, setMood] = useState('')
  const [view, setView] = useState<View>(viewFromHash)
  const pageRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setHomework(await loadHomework())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(
        storageMode === 'oss'
          ? `无法从阿里云 OSS 读取作业（${msg}）。请确认 Bucket、密钥与跨域（CORS）设置。`
          : `读取本机作业失败：${msg}`,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Browser back/forward moves between the two views.
  useEffect(() => {
    const onPop = () => setView(viewFromHash())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const enterHomework = (m: string) => {
    setMood(m)
    if (pageRef.current) pageRef.current.scrollTop = 0
    setView('homework')
    if (location.hash !== '#homework') history.pushState({ zyx: 'homework' }, '', '#homework')
    window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), reducedMotion() ? 0 : 900)
  }

  const backToHero = () => {
    // Only step back if we pushed the entry ourselves; otherwise back would leave the site.
    if (history.state?.zyx === 'homework') {
      history.back()
    } else {
      history.replaceState(null, '', location.pathname + location.search)
      setView('hero')
    }
  }

  const onHomework = view === 'homework'

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      {/* View 1 — the carriage. On the homework page its scenery stays on as a dimmed backdrop. */}
      <div className="absolute inset-0" inert={onHomework}>
        <Hero active={!onHomework} onGetHomework={enterHomework} />
      </div>

      {/* View 2 — the homework page, its own scroll container. */}
      <div
        ref={pageRef}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain transition-[opacity,transform,visibility] duration-[1000ms] ease-[cubic-bezier(0.22,0.8,0.24,1)] motion-reduce:transition-none"
        style={{
          opacity: onHomework ? 1 : 0,
          transform: onHomework ? 'none' : 'translateY(28px)',
          visibility: onHomework ? 'visible' : 'hidden',
          transitionDelay: onHomework ? '250ms' : '0ms',
        }}
        inert={!onHomework}
        aria-hidden={!onHomework}
      >
        <div className="relative min-h-full">
          {/* Readability scrim over the dimmed scenery — dark enough for text, light enough to feel the view */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(5,8,13,0.62) 0%, rgba(6,10,16,0.48) 40%, rgba(6,10,16,0.58) 100%),' +
                'radial-gradient(70rem 50rem at 50% 30%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 100%)',
            }}
          />

          <button
            type="button"
            onClick={backToHero}
            aria-label="回到车窗"
            title="回到车窗"
            className="liquid-glass fixed top-[max(1rem,env(safe-area-inset-top))] left-4 z-40 grid h-10 w-10 cursor-pointer place-items-center rounded-full text-white/80 transition hover:text-white sm:top-6 sm:left-8 sm:h-11 sm:w-11"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>

          <div className="relative">
            <HomeworkSection
              headingRef={headingRef}
              mood={mood}
              homework={homework}
              loading={loading}
              error={error}
              onReload={reload}
              onCreated={(hw) => setHomework((prev) => [hw, ...prev])}
              onRemoved={(id) => setHomework((prev) => prev.filter((h) => h.id !== id))}
            />
            <Footer onHome={backToHero} />
          </div>
        </div>
      </div>
    </main>
  )
}

function Footer({ onHome }: { onHome: () => void }) {
  return (
    <footer className="px-4 pt-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-white/10 pt-8 text-xs text-white/40 sm:flex-row">
        <span className="tracking-[0.2em]">作业箱 · 安静地写作业</span>
        <button type="button" onClick={onHome} className="cursor-pointer hover:text-white/80">
          回到车窗 ←
        </button>
      </div>
    </footer>
  )
}
