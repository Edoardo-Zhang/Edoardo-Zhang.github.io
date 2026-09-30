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
