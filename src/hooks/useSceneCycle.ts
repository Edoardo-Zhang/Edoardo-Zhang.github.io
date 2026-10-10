import { useCallback, useRef, useState } from 'react'

export const FADE_MS = 1000
/** If the next clip still is not loaded after this long, move on anyway (its poster still shows). */
const MAX_WAIT_MS = 8_000

/**
 * Scene carousel state.
 * Timing is driven by the clips themselves: the playing scene calls `advance()` when it is
 * FADE_MS from its end, so every scene stays exactly as long as its own clip. Because the clip
 * drives it, the cycle naturally pauses with a hidden tab and restarts from the new clip's first
 * frame after a manual pick.
 *
 * On slow networks the next clip may not be loaded yet when its turn comes. Instead of cutting to a
 * half-loaded (stuttering) scene, the carousel waits — the current clip rests on its last frame —
 * and cross-fades as soon as the next clip reports `markReady`.
 * A lock rejects switch requests while a cross-fade is running.
 */
export function useSceneCycle(count: number) {
  const [active, setActive] = useState(0)
  const [ready, setReady] = useState<boolean[]>(() => Array(count).fill(false))
  const activeRef = useRef(0)
  const readyRef = useRef<boolean[]>(Array(count).fill(false))
  const lockRef = useRef(false)
  const pendingRef = useRef(false)
  const waitTimer = useRef<number | undefined>(undefined)

  const go = useCallback((index: number) => {
    if (lockRef.current || index === activeRef.current) return
    pendingRef.current = false
    window.clearTimeout(waitTimer.current)
    lockRef.current = true
    activeRef.current = index
    setActive(index)
    window.setTimeout(() => {
      lockRef.current = false
    }, FADE_MS)
  }, [])

  /** Manual selection: switch immediately; the new clip starts from 0, which restarts its timing. */
  const select = go

  /** Called by the playing clip shortly before it ends. */
  const advance = useCallback(() => {
    const next = (activeRef.current + 1) % count
    if (readyRef.current[next]) return go(next)
    pendingRef.current = true
    window.clearTimeout(waitTimer.current)
    waitTimer.current = window.setTimeout(() => {
      if (pendingRef.current) go((activeRef.current + 1) % count)
    }, MAX_WAIT_MS)
  }, [go, count])

  /** Called once per scene when its clip is fully buffered. */
  const markReady = useCallback(
    (index: number) => {
      if (readyRef.current[index]) return
      readyRef.current = readyRef.current.map((r, i) => r || i === index)
      setReady(readyRef.current)
      if (pendingRef.current && index === (activeRef.current + 1) % count) go(index)
    },
    [go, count],
  )

  return { active, ready, select, advance, markReady }
}
