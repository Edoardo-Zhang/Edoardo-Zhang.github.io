import { useEffect, useMemo } from 'react'
import { isImageFile } from './homework'

/** 给一组本地文件生成 objectURL，文件列表变化或组件卸载时自动释放，避免内存泄漏。 */
export function useFileUrls(files: File[]) {
  const urls = useMemo(() => {
    const m = new Map<File, string>()
    for (const f of files) m.set(f, URL.createObjectURL(f))
    return m
  }, [files])

  useEffect(
    () => () => {
      for (const u of urls.values()) URL.revokeObjectURL(u)
    },
    [urls],
  )

  return urls
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'audio' | null

const TEXT_RE = /\.(txt|md|markdown|csv|tsv|json|log|yaml|yml|xml|html?|css|js|mjs|ts|tsx|py|c|cpp|h|java|ini|cfg|conf|tex)$/i

/** 这个文件能不能在浏览器里直接预览；null 表示不支持（Office / 压缩包等）。 */
export function previewKindOf(f: { name: string; type?: string }): PreviewKind {
  if (isImageFile(f)) return 'image'
  const t = (f.type || '').toLowerCase()
  if (t === 'application/pdf' || /\.pdf$/i.test(f.name)) return 'pdf'
  if (t.startsWith('text/') || TEXT_RE.test(f.name)) return 'text'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  return null
}
