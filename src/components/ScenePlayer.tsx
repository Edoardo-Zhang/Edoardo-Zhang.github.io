import { useEffect, useRef, useState } from 'react'

/** Hand over to the next scene slightly before the clip's last frame. */
const END_MARGIN_S = 0.15
/** A clip counts as ready once it is buffered to within this much of its end. */
const READY_SLACK_S = 0.25

interface ScenePlayerProps {
  src: string
  poster: string
  active: boolean
  /** Stacking order: the incoming scene sits above the outgoing one while it fades in. */
  z: number
  fadeMs: number
  /** Fired once per pass, `fadeMs` (+margin) before the clip ends, while active. */
  onNearEnd: () => void
  /** Fired once when the whole clip is buffered, so the carousel never cuts to a half-loaded scene. */
  onReady: () => void
  /** 即将上场、需要提前预取时置 true；冷场景完全不下载。 */
  warm?: boolean
}

const bufferedEnd = (v: HTMLVideoElement) => (v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0)
const fullyBuffered = (v: HTMLVideoElement) =>
  v.readyState >= v.HAVE_ENOUGH_DATA && Number.isFinite(v.duration) && v.duration > 0 && bufferedEnd(v) >= v.duration - READY_SLACK_S

/**
 * One scene = one <video>, played exactly once per turn (no `loop`): if the next scene is still
 * loading, this clip simply rests on its last frame until the carousel moves on.
 *
 * Slow networks are the main concern here:
 * - a download that is still progressing is never aborted (no reload-on-buffering);
 * - playback only starts once the clip can play through, so viewers see the still poster
 *   instead of a stuttering video;
 * - real errors are retried with exponential back-off.
 */
export default function ScenePlayer({ src, poster, active, z, fadeMs, onNearEnd, onReady, warm = false }: ScenePlayerProps) {
  const ref = useRef<HTMLVideoElement>(null)
  /** The video has actually drawn a frame — until then the still image underneath shows (never black). */
  const [hasFrame, setHasFrame] = useState(false)
  const nearEndRef = useRef(onNearEnd)
  const readyRef = useRef(onReady)

  useEffect(() => {
    nearEndRef.current = onNearEnd
    readyRef.current = onReady
  }, [onNearEnd, onReady])

  // 只有“正在播”或“即将上场”的场景才开始下载；冷场景完全不占带宽。
  useEffect(() => {
    const v = ref.current
    if (!v || !(active || warm)) return
    if (v.networkState === v.NETWORK_EMPTY || (v.networkState === v.NETWORK_IDLE && v.readyState === v.HAVE_NOTHING)) {
      v.preload = 'auto'
      v.load()
    }
  }, [active, warm])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const on = () => v.readyState >= v.HAVE_CURRENT_DATA && setHasFrame(true)
    const off = () => setHasFrame(false)
    v.addEventListener('loadeddata', on)
    v.addEventListener('playing', on)
    v.addEventListener('emptied', off)
    return () => {
      v.removeEventListener('loadeddata', on)
      v.removeEventListener('playing', on)
      v.removeEventListener('emptied', off)
    }
  }, [])

  // Report "fully buffered" once; also retry real errors with back-off (never while still downloading).
  useEffect(() => {
    const v = ref.current
    if (!v) return
    let reported = false
    let retry: number | undefined
    let attempt = 0
    const report = () => {
      if (!reported && fullyBuffered(v)) {
        reported = true
        readyRef.current()
      }
    }
    const onError = () => {
      window.clearTimeout(retry)
      const delay = Math.min(16000, 1000 * 2 ** attempt++)
      retry = window.setTimeout(() => {
        if (!document.hidden) v.load()
      }, delay)
    }
    const events = ['progress', 'canplaythrough', 'loadeddata', 'durationchange'] as const
    events.forEach((e) => v.addEventListener(e, report))
    v.addEventListener('error', onError)
    report()
    return () => {
      events.forEach((e) => v.removeEventListener(e, report))
      v.removeEventListener('error', onError)
      window.clearTimeout(retry)
    }
  }, [])

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
    /** When this clip first became playable during this turn — the autoplay fallback counts from here. */
    let playableAt = v.readyState >= v.HAVE_ENOUGH_DATA ? performance.now() : 0

    if (v.readyState > 0) v.currentTime = 0

    // Start only when the clip can play through — until then the poster (a still of the first frame) shows.
    const start = () => {
      if (!playableAt && v.readyState >= v.HAVE_ENOUGH_DATA) playableAt = performance.now()
      if (!v.ended || v.currentTime < 0.1) v.play().catch(() => {})
    }
    if (v.readyState >= v.HAVE_ENOUGH_DATA) start()
    v.addEventListener('canplaythrough', start)
    // Some phones never buffer ahead without a play() call; nudge them after a moment.
    const kick = window.setTimeout(() => {
      if (v.paused && v.readyState < v.HAVE_FUTURE_DATA && v.networkState !== v.NETWORK_LOADING) start()
    }, 2500)

    const check = () => {
      const d = v.duration
      const t = v.currentTime
      if (!d || !Number.isFinite(d) || announced) return
      const lead = d - fadeMs / 1000 - END_MARGIN_S
      // Autoplay refused but the clip is loaded: fall back to wall-clock time (counted from when it became
      // playable, not from when the scene appeared) so the cycle never stalls.
      const blocked =
        v.paused && !v.ended && playableAt > 0 && !document.hidden && (performance.now() - playableAt) / 1000 >= lead
      if (t >= lead || blocked) {
        announced = true
        nearEndRef.current()
      }
    }

    // Gentle watchdog: only nudges a clip that has data but froze. Never reloads while downloading.
    const watchdog = () => {
      if (document.hidden) return
      const now = performance.now()
      if (!playableAt && v.readyState >= v.HAVE_ENOUGH_DATA) playableAt = now
      const frozen = !v.paused && !v.ended && v.readyState >= v.HAVE_FUTURE_DATA && v.currentTime === lastT
      if (frozen) {
        if (!stuckSince) stuckSince = now
        else if (now - stuckSince > 3000) {
          stuckSince = 0
          v.play().catch(() => {})
        }
      } else stuckSince = 0
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
      if (!document.hidden && v.paused && !v.ended && v.readyState >= v.HAVE_FUTURE_DATA) v.play().catch(() => {})
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('pointerdown', resume, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(poll)
      window.clearTimeout(kick)
      v.removeEventListener('canplaythrough', start)
      v.removeEventListener('timeupdate', check)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('pointerdown', resume)
    }
  }, [active, fadeMs])

  return (
    // One layer per scene: a still image that is always there, with the video fading in on top once it
    // has a real frame. The cross-fade between scenes happens on the layer, so a scene that is still
    // loading shows its still instead of black.
    <div
      className="absolute inset-0 transition-opacity ease-in-out"
      style={{
        zIndex: z,
        opacity: active ? 1 : 0,
        transitionDuration: active ? `${fadeMs}ms` : '0ms',
        // Outgoing scene: stay opaque under the incoming one, then drop out once it is covered.
        transitionDelay: active ? '0ms' : `${fadeMs}ms`,
      }}
    >
      <img
        src={poster}
        alt=""
        decoding="async"
        fetchPriority={active ? 'high' : 'low'}
        className="absolute inset-0 h-full w-full object-cover select-none"
        draggable={false}
      />
      <video
        ref={ref}
        src={src}
        muted
        playsInline
        preload={active || warm ? 'auto' : 'none'}
        disablePictureInPicture
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out"
        style={{ opacity: hasFrame ? 1 : 0 }}
      />
    </div>
  )
}
