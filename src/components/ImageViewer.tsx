import { useEffect, useRef, useState } from 'react'

export interface ViewerImage {
  name: string
  /** Resized image shown on the page (≤1920 px). */
  src: string
  /** Original file download link. */
  downloadHref: string
}

/** Full-screen image viewer: click outside / Esc closes, arrows or swipe move between images. */
export default function ImageViewer({ images, index, onClose }: { images: ViewerImage[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index)
  const [loaded, setLoaded] = useState(false)
  const touchX = useRef<number | null>(null)
  const img = images[i]
  const many = images.length > 1

  const go = (d: number) => {
    setLoaded(false)
    setI((cur) => (cur + d + images.length) % images.length)
  }

  useEffect(() => {
    // Capture phase + stopImmediatePropagation: Esc closes only the image, not the dialog behind it
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      } else if (many && e.key === 'ArrowRight') go(1)
      else if (many && e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [many, onClose])

  if (!img) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={`查看图片：${img.name}`}
      onClick={onClose}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (!many || touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
      }}
    >
      <header className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 text-sm text-white/80" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate" title={img.name}>
          {img.name}
          {many && <span className="ml-2 text-white/45 tabular-nums">{i + 1} / {images.length}</span>}
        </span>
        <a href={img.downloadHref} className="shrink-0 rounded-md px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          下载原图
        </a>
        <button type="button" onClick={onClose} aria-label="关闭" className="shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-lg leading-none text-white/70 hover:bg-white/10 hover:text-white">
          ×
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!loaded && <span className="absolute text-sm text-white/40">加载中…</span>}
        <img
          key={img.src}
          src={img.src}
          alt={img.name}
          onLoad={() => setLoaded(true)}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain transition-opacity duration-200"
          style={{ opacity: loaded ? 1 : 0 }}
          draggable={false}
        />
        {many && (
          <>
            <button
              type="button"
              aria-label="上一张"
              onClick={(e) => {
                e.stopPropagation()
                go(-1)
              }}
              className="absolute top-1/2 left-2 hidden h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 text-xl text-white/80 hover:bg-white/20 sm:grid"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="下一张"
              onClick={(e) => {
                e.stopPropagation()
                go(1)
              }}
              className="absolute top-1/2 right-2 hidden h-11 w-11 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-white/10 text-xl text-white/80 hover:bg-white/20 sm:grid"
            >
              ›
            </button>
          </>
        )}
      </div>
    </div>
  )
}
