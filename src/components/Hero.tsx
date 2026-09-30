import { useEffect, useState, type FormEvent } from 'react'
import { FADE_MS, useSceneCycle } from '../hooks/useSceneCycle'
import ScenePlayer from './ScenePlayer'

const SCENES = [
  { name: '金色时刻', src: 'input-assets/golden-hour.mp4' },
  { name: '静水', src: 'input-assets/still-water.mp4' },
  { name: '深林', src: 'input-assets/deep-forest.mp4' },
  { name: '静谧黎明', src: 'input-assets/quiet-dawn.mp4' },
] as const

const FOREST = 2

interface HeroProps {
  active?: boolean // false while the homework page is shown over the (dimmed) scenery
  onGetHomework: (mood: string) => void
}

export default function Hero({ active: visible = true, onGetHomework }: HeroProps) {
  // The carousel keeps running on the homework page too, so the backdrop never loops a single clip.
  const { active, select, advance } = useSceneCycle(SCENES.length)
  const [mood, setMood] = useState('')
  const [warmIndex, setWarmIndex] = useState<number | null>(null)
  const isForest = active === FOREST

  // 先让当前这段独享带宽 1 秒，再预取下一段：首屏出画不受影响，下一段也有近 2 秒缓冲（每段只停留约 3 秒）。
  useEffect(() => {
    setWarmIndex(null)
    const t = window.setTimeout(() => setWarmIndex((active + 1) % SCENES.length), 1000)
    return () => window.clearTimeout(t)
  }, [active])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onGetHomework(mood.trim())
  }

  return (
    <section id="top" className="hero-root" aria-label="作业箱首屏">
      {/* Layer 0 — four stacked scenes. Dimmed + softened when they become the homework backdrop. */}
      <div
        className="absolute inset-0 z-0 transition-[filter,transform] duration-[1100ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
        style={{
          filter: visible ? 'none' : 'brightness(0.62) saturate(0.9) blur(3px)',
          transform: visible ? 'none' : 'scale(1.05)', // hides the blurred edge
        }}
        aria-hidden="true"
      >
        {SCENES.map((s, i) => (
          <ScenePlayer
            key={s.src}
            src={s.src}
            active={i === active}
            warm={i === warmIndex}
            z={i === active ? 2 : 1}
            fadeMs={FADE_MS}
            onNearEnd={advance}
          />
        ))}
      </div>

      {/* Layer 1 — carriage foreground (window.png), breathing without exposing edges.
          Drifts past the camera and fades out when leaving for the homework page. */}
      <div
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden transition-[opacity,transform] duration-[1100ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'none' : 'scale(1.12)' }}
        aria-hidden="true"
      >
        <img
          src="input-assets/window.webp"
          alt=""
          className="carriage absolute inset-0 h-full w-full object-cover select-none"
          draggable={false}
          decoding="async"
          fetchPriority="high"
        />
      </div>

      {/* Layer 2 — text & controls */}
      <div
        className="relative z-20 flex h-full flex-col px-4 transition-[opacity,transform,filter,visibility] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none sm:px-8"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'none' : 'scale(0.97)',
          filter: visible ? 'none' : 'blur(6px)',
          visibility: visible ? 'visible' : 'hidden',
        }}
        inert={!visible}
      >
        <div className="h-6 shrink-0 sm:h-10 short:h-4" />

        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center text-center"
          style={{
            color: isForest ? '#182C41' : '#FFFFFF',
            // A barely-there halo keeps text legible on both bright skies and dark forest.
            textShadow: isForest ? '0 1px 16px rgba(255,255,255,0.35)' : '0 1px 18px rgba(0,0,0,0.28)',
            transition: 'color 700ms ease-in-out, text-shadow 700ms ease-in-out',
          }}
        >
          <div className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.72rem] tracking-[0.18em] sm:text-xs tiny:hidden">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-50" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            专注模式 · 今日作业已就绪
          </div>

          <h1 className="mt-5 max-w-[64rem] font-headline text-[clamp(1.45rem,7.6vw,5.5rem)] leading-[1.1] font-normal tracking-[0.01em] sm:mt-7 short:mt-4 short:text-[clamp(1.45rem,min(7.6vw,9vh),5.5rem)]">
            <span className="block whitespace-nowrap">在永不停歇的嘈杂世界里</span>
            <span className="block whitespace-nowrap">找回作业</span>
          </h1>

          {/* 空行占位：原说明文案已删，保留原来两行文字所占据的高度，标题与表单的间距与删除前一致 */}
          <p
            aria-hidden="true"
            className="mt-4 max-w-[36rem] text-[0.9rem] leading-[1.85] sm:mt-6 sm:text-base short:mt-3 short:leading-[1.7] tiny:hidden"
          >
            &nbsp;
            <br />
            &nbsp;
          </p>

          <form
            onSubmit={submit}
            className="liquid-glass mt-6 flex w-full max-w-[26rem] items-center gap-1.5 rounded-full p-1.5 sm:mt-9 short:mt-4"
          >
            <label htmlFor="mood" className="sr-only">
              此刻的心境
            </label>
            <input
              id="mood"
              value={mood}
              onChange={(e) => setMood(e.target.value)}
              placeholder="请先调整你的心境"
              maxLength={40}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-4 text-sm text-current outline-none placeholder:text-current placeholder:opacity-60 sm:text-[0.95rem]"
            />
            <button
              type="submit"
              className="shrink-0 cursor-pointer rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#0d1520] shadow-[0_6px_20px_-8px_rgba(0,0,0,0.45)] transition hover:bg-white/90 active:scale-[0.97] sm:px-6"
            >
              获取作业
            </button>
          </form>

          <div role="group" aria-label="切换风景" className="mt-7 flex items-center gap-4 text-[0.8rem] sm:mt-10 sm:gap-7 sm:text-sm short:mt-5">
            {SCENES.map((s, i) => {
              const selected = i === active
              return (
                <button
                  key={s.name}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => select(i)}
                  className={`cursor-pointer border-b pb-1 tracking-[0.12em] transition-opacity duration-300 ${
                    selected ? 'border-current opacity-100' : 'border-transparent opacity-50 hover:opacity-80'
                  }`}
                >
                  {s.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="h-6 shrink-0 pb-[env(safe-area-inset-bottom)] sm:h-10 short:h-4" />
      </div>
    </section>
  )
}
