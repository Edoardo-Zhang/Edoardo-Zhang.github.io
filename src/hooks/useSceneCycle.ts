import { useCallback, useEffect, useRef, useState } from 'react'

export const FADE_MS = 1000
export const INTERVAL_MS = 10_000

/**
 * Drives the scene carousel.
 * - A single timeout is ever alive (timerRef); every (re)schedule clears the previous one.
 * - A lock rejects switch requests while a 1000 ms cross-fade is running.
 * - The countdown is paused while the tab is hidden and resumed with the remaining time.
 */
export function useSceneCycle(count: number, paused = false) {
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const lockRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)
  const dueRef = useRef(0)
  const remainingRef = useRef<number | null>(null)
  const goRef = useRef<(i: number) => boolean>(() => false)
  const pausedRef = useRef(paused)

  const schedule = useCallback(
    function schedule(delay: number) {
      window.clearTimeout(timerRef.current)
      dueRef.current = Date.now() + delay
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined
        const ok = goRef.current((activeRef.current + 1) % count)
        // Should the lock ever still be held, try again right after the fade window.
        if (!ok) schedule(FADE_MS)
      }, delay)
    },
    [count],
  )

  const go = useCallback(
    (index: number) => {
      if (lockRef.current || index === activeRef.current) return false
      lockRef.current = true
      activeRef.current = index
      setActive(index)
      window.setTimeout(() => {
        lockRef.current = false
      }, FADE_MS)
      if (pausedRef.current) return true
      if (!document.hidden) schedule(INTERVAL_MS)
      else remainingRef.current = INTERVAL_MS
      return true
    },
    [schedule],
  )
  useEffect(() => {
    goRef.current = go
  }, [go])

  /** Manual selection: switch now and restart the 10 s countdown. */
  const select = useCallback(
    (index: number) => {
      if (index === activeRef.current && !lockRef.current) {
        schedule(INTERVAL_MS)
        return
      }
      go(index)
    },
    [go, schedule],
  )

  // Freeze on the current scene while paused; restart a full interval when resumed.
  useEffect(() => {
    pausedRef.current = paused
    if (paused) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
      remainingRef.current = null
    } else {
      schedule(INTERVAL_MS)
    }
  }, [paused, schedule])

  useEffect(() => {
    const onVisibility = () => {
      if (pausedRef.current) return
      if (document.hidden) {
        if (timerRef.current !== undefined) {
          remainingRef.current = Math.max(0, dueRef.current - Date.now())
          window.clearTimeout(timerRef.current)
          timerRef.current = undefined
        }
      } else {
        // Give the eye a moment to settle before resuming the cycle.
        const remaining = remainingRef.current ?? INTERVAL_MS
        remainingRef.current = null
        schedule(Math.max(remaining, 1500))
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [schedule])

  return { active, select }
}
