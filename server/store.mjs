// OSS 读写封装：全部走服务端预签名 URL，使用 fetch。
import { presign } from './oss.mjs'

const decodeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

async function ossError(res, lead) {
  const text = await res.text().catch(() => '')
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
  const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1]
  const err = new Error(`${lead}：OSS ${res.status}${code ? ' ' + code : ''}${msg ? '（' + msg + '）' : ''}`)
  err.status = 502
  return err
}

export async function putObject(cfg, key, body, contentType = 'application/octet-stream') {
  const res = await fetch(presign(cfg, { method: 'PUT', key, contentType, expiresIn: 300 }), {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  })
  if (!res.ok) throw await ossError(res, '写入 OSS 失败')
}

export async function getText(cfg, key) {
  const res = await fetch(presign(cfg, { method: 'GET', key, expiresIn: 300 }))
  if (res.status === 404) return null
  if (!res.ok) throw await ossError(res, '读取 OSS 失败')
  return res.text()
}

export async function getJson(cfg, key) {
  const text = await getText(cfg, key)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function deleteObject(cfg, key) {
  const res = await fetch(presign(cfg, { method: 'DELETE', key, expiresIn: 300 }), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw await ossError(res, '删除 OSS 对象失败')
}

/** 对象是否存在（用于 commit 前校验上传结果）。 */
export async function objectExists(cfg, key) {
  const res = await fetch(presign(cfg, { method: 'HEAD', key, expiresIn: 300 }), { method: 'HEAD' })
  return res.ok
}

export async function listKeys(cfg, prefix) {
  const keys = []
  let marker = ''
  for (let page = 0; page < 50; page++) {
    const query = { prefix, 'max-keys': '1000' }
    if (marker) query.marker = marker
    const res = await fetch(presign(cfg, { method: 'GET', key: '', expiresIn: 300, subResources: query }))
    if (!res.ok) throw await ossError(res, '列举 OSS 对象失败')
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) keys.push(decodeXml(m[1]))
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break
    marker = decodeXml(/<NextMarker>([\s\S]*?)<\/NextMarker>/.exec(xml)?.[1] ?? '') || keys[keys.length - 1] || ''
    if (!marker) break
  }
  return keys
}

/** 带 Content-Disposition 的下载链接（文件名不会进 header 原样，已做清洗）。 */
export function downloadUrl(cfg, key, filename, expiresIn = 3600) {
  const safe = String(filename || 'download').replace(/[\r\n"\\]/g, '_').slice(0, 120)
  return presign(cfg, {
    method: 'GET',
    key,
    expiresIn,
    subResources: { 'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safe)}` },
  })
}

// ---- 图片在线查看 ----
// 常见可显示的图片格式；HEIC/HEIF（iPhone 照片）由 OSS 图片处理转成 JPEG 再显示。
export const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i
const PROCESS = {
  // 卡片 / 统计里的缩略图：最长边 480，转 WebP（通常几十 KB）
  thumb: 'image/auto-orient,1/resize,m_lfit,w_480,h_480/format,webp',
  // 点开后的大图：最长边 1920，足够看清又不必下载几 MB 的原图
  full: 'image/auto-orient,1/resize,m_lfit,w_1920,h_1920/quality,q_85',
}

/** 图片的在线查看链接（inline，不触发下载）；variant 为 thumb / full。 */
export function imageViewUrl(cfg, key, variant = 'full', expiresIn = 3600) {
  let proc = PROCESS[variant] || PROCESS.full
  if (variant === 'full' && /\.(heic|heif)$/i.test(key)) proc += '/format,jpg'
  return presign(cfg, {
    method: 'GET',
    key,
    expiresIn,
    subResources: { 'x-oss-process': proc, 'response-content-disposition': 'inline' },
  })
}
