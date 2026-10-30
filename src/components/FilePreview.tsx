import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ImageViewer from './ImageViewer'
import { fileKind, formatBytes } from '../lib/homework'
import { previewKindOf } from '../lib/filePreview'

const barButton =
  'cursor-pointer rounded-md px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white'

/** 本地文件预览层：图片走全屏查看器，PDF / 文本 / 音视频在层内显示，其它格式给出说明。 */
export default function LocalFileViewer({ file, url, onClose }: { file: File; url: string; onClose: () => void }) {
  const kind = previewKindOf(file)
  // 只存"已读到的那个文件的内容"，避免在 effect 里同步 setState
  const [loaded, setLoaded] = useState<{ file: File; text?: string; error?: string } | null>(null)

  useEffect(() => {
    if (kind !== 'text') return
    let alive = true
    file
      .text()
      .then((t) => alive && setLoaded({ file, text: t.slice(0, 400_000) }))
      .catch((err) => alive && setLoaded({ file, error: err instanceof Error ? err.message : '读取失败' }))
    return () => {
      alive = false
    }
  }, [file, kind])

  useEffect(() => {
    if (kind === 'image') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [kind, onClose])

  // 卡片上有 backdrop-filter，会让 position:fixed 以卡片为参照 → 预览层必须挂到 body 才是真正的全屏
  if (kind === 'image') {
    return createPortal(
      <ImageViewer images={[{ name: file.name, src: url, downloadHref: url }]} index={0} onClose={onClose} />,
      document.body,
    )
  }

  const text = loaded?.file === file ? loaded.text : undefined
  const textError = loaded?.file === file ? loaded.error : undefined

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`预览：${file.name}`}>
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-3 py-2.5 sm:px-4">
        <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[0.6rem] tracking-wider text-white/70">
          {fileKind(file)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/85" title={file.name}>
          {file.name}
        </span>
        <span className="hidden shrink-0 text-xs text-white/40 sm:block">{formatBytes(file.size)}</span>
        <a href={url} target="_blank" rel="noreferrer" className={`shrink-0 ${barButton}`}>
          新标签打开
        </a>
        <button type="button" onClick={onClose} className={`shrink-0 ${barButton}`} aria-label="关闭预览">
          关闭
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-2 sm:p-4">
        {kind === 'pdf' && <iframe src={url} title={file.name} className="h-full w-full rounded-lg bg-white" />}
        {kind === 'text' && (
          <div className="h-full overflow-auto rounded-lg bg-white/[0.04] p-3">
            {textError ? (
              <p className="text-xs text-rose-300">{textError}</p>
            ) : text === undefined ? (
              <p className="text-xs text-white/45">读取中…</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-white/80">{text || '（空文件）'}</pre>
            )}
          </div>
        )}
        {kind === 'video' && (
          <div className="flex h-full items-center justify-center">
            <video src={url} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg bg-black" />
          </div>
        )}
        {kind === 'audio' && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <span className="text-xs text-white/55">{file.name}</span>
            <audio src={url} controls autoPlay className="w-full max-w-lg" />
          </div>
        )}
        {kind === null && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-white/70">这个格式浏览器里没法预览</p>
            <p className="text-xs text-white/40">
              {fileKind(file)} · {formatBytes(file.size)} · 提交后老师可以下载查看
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
