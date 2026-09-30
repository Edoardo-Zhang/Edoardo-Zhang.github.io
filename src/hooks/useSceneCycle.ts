import { useCallback, useRef, useState } from 'react'

export const FADE_MS = 1000

/**
 * Scene carousel state.
 * Timing is driven by the clips themselves: the playing scene calls `advance()` when it is
 * FADE_MS from its end, so every scene stays exactly as long as its own clip (no timers to drift,
 * nothing to duplicate). Because the clip drives it, the cycle naturally pauses with a hidden tab
 * and restarts from the new clip's first frame after a manual pick.
 * A lock rejects switch requests while a cross-fade is running.
 */
export function useSceneCycle(count: number) {
  const [active, setActive] = useState(0)
  const activeRef = useRef(0)
  const lockRef = useRef(false)

  const go = useCallback((index: number) => {
    if (lockRef.current || index === activeRef.current) return
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
  const advance = useCallback(() => go((activeRef.current + 1) % count), [go, count])

  return { active, select, advance }
}
