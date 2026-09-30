import { useEffect, useRef } from 'react'

/** Hand over to the next scene slightly before the clip's last frame, so the outgoing clip
 *  never reaches its end (and wraps to frame 0) while it is still visible. */
const END_MARGIN_S = 0.15

interface ScenePlayerProps {
  src: string
  active: boolean
  /** Stacking order: the incoming scene sits above the outgoing one while it fades in. */
  z: number
  fadeMs: number
  /** Fired once per pass, `fadeMs` (+margin) before the clip ends, while active. */
  onNearEnd: () => void
  /** 即将上场、需要提前预取时置 true；冷场景完全不下载。 */
  warm?: boolean
}

/**
 * One scene = one <video>. Each scene is on screen for exactly its own clip length: it enters from
 * its first frame and, near the end, asks the carousel to move on. Only the visible scene(s) decode;
 * the rest are paused, keeping the number of live decoders to at most two.
 */
export default function ScenePlayer({ src, active, z, fadeMs, onNearEnd, warm = false }: ScenePlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const nearEndRef = useRef(onNearEnd)

  useEffect(() => {
    nearEndRef.current = onNearEnd
  }, [onNearEnd])

  // 首屏不再同时拉四段视频（原来 27MB 一起下，互相抢带宽，正在播的那段会卡）：
  // 只有"正在播"或"即将上场"的场景才开始加载。
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if ((active || warm) && v.networkState === v.NETWORK_EMPTY) {
      v.preload = 'auto'
      v.load()
    }
  }, [active, warm])

  useEffect(() => {
    const v = ref.current
    if (!v) return

    if (!active) {
      // Stay fully visible underneath while the incoming scene fades in on top, then rest the decoder.
      const t = window.setTimeout(() => v.pause(), fadeMs + 80)
      return () => window.clearTimeout(t)
    }

    let announced = false
    let lastT = -1
    let stuckSince = 0
    const enteredAt = performance.now()

    if (v.readyState > 0) v.currentTime = 0
    v.play().catch(() => {})

    const check = () => {
      const d = v.duration
      const t = v.currentTime
      if (d && Number.isFinite(d)) {
        const lead = d - fadeMs / 1000 - END_MARGIN_S
        // If playback is refused (autoplay blocked), fall back to wall-clock time so the cycle never stalls.
        const stalled = v.paused && !document.hidden && (performance.now() - enteredAt) / 1000 >= lead
        if (!announced && (t >= lead || stalled)) {
          announced = true
          nearEndRef.current()
        }
      }
    }

    // Watchdog: if the visible clip errors out or stops advancing, reload it and play again.
    const watchdog = () => {
      if (document.hidden) return
      const now = performance.now()
      if (v.error) {
        v.load()
        v.play().catch(() => {})
        return
      }
      if (!v.paused && v.currentTime === lastT) {
        if (!stuckSince) stuckSince = now
        else if (now - stuckSince > 2000) {
          stuckSince = 0
          const at = v.currentTime
          v.load()
          v.currentTime = at
          v.play().catch(() => {})
        }
      } else stuckSince = 0
      if (v.paused) v.play().catch(() => {})
      lastT = v.currentTime
      check()
    }

    let raf = 0
    const tick = () => {
      check()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const poll = window.setInterval(watchdog, 500)
    v.addEventListener('timeupdate', check)

    // Autoplay can be refused (hidden tab at load, low-power mode) — retry on return and first touch.
    const resume = () => {
      if (!document.hidden && v.paused) v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pointerdown', resume, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(poll)
      v.removeEventListener('timeupdate', check)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('pointerdown', resume)
    }
  }, [active, fadeMs])

  return (
    <video
      ref={ref}
      src={src}
      muted
      autoPlay={active}
      loop // safety net only: the carousel always moves on before the clip ends
      playsInline
      preload={active || warm ? 'auto' : 'none'}
      disablePictureInPicture
      className="absolute inset-0 h-full w-full object-cover transition-opacity ease-in-out"
      style={{
        zIndex: z,
        opacity: active ? 1 : 0,
        transitionDuration: active ? `${fadeMs}ms` : '0ms',
        // Outgoing scene: stay opaque under the incoming one, then drop out once it is covered.
        transitionDelay: active ? '0ms' : `${fadeMs}ms`,
      }}
    />
  )
}
