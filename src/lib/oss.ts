// Browser-direct Aliyun OSS client (no backend).
// Requests are authorised with presigned URLs (OSS signature V4), which avoids
// the need for a `Date` header that browsers refuse to set.
//
// SECURITY: any credential shipped to the browser is visible to every visitor.
// Use a RAM sub-account (or STS token) that is restricted to this bucket + prefix only.
import { hmacSha256, sha256, toHex } from './sha256'

export interface OssConfig {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  stsToken?: string
  prefix: string
  host: string
}

function readConfig(): OssConfig | null {
  const env: ImportMetaEnv = import.meta.env ?? {}
  const region = (env.VITE_OSS_REGION ?? '').trim()
  const bucket = (env.VITE_OSS_BUCKET ?? '').trim()
  const accessKeyId = (env.VITE_OSS_ACCESS_KEY_ID ?? '').trim()
  const accessKeySecret = (env.VITE_OSS_ACCESS_KEY_SECRET ?? '').trim()
  if (!region || !bucket || !accessKeyId || !accessKeySecret) return null
  let prefix = (env.VITE_OSS_PREFIX ?? 'zuoyexiang/').trim().replace(/^\/+/, '')
  if (prefix && !prefix.endsWith('/')) prefix += '/'
  const normalizedRegion = region.startsWith('oss-') ? region : `oss-${region}`
  return {
    region: normalizedRegion,
    bucket,
    accessKeyId,
    accessKeySecret,
    stsToken: (env.VITE_OSS_STS_TOKEN ?? '').trim() || undefined,
    prefix,
    host: `https://${bucket}.${normalizedRegion}.aliyuncs.com`,
  }
}

export const ossConfig = readConfig()

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/')

interface SignOptions {
  method: 'GET' | 'PUT' | 'DELETE'
  key: string // '' for bucket-level operations
  contentType?: string
  expiresIn?: number // seconds
  subResources?: Record<string, string> // signed query params (e.g. response-content-disposition)
  query?: Record<string, string> // unsigned query params (e.g. prefix, marker)
}

// RFC 3986 encoding as OSS expects (encodeURIComponent leaves !'()* unescaped).
const enc3986 = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** Presigned URL, OSS signature V4 (OSS4-HMAC-SHA256). */
export function signedUrl(cfg: OssConfig, opts: SignOptions): string {
  const now = new Date(Date.now())
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') // yyyymmddTHHMMSSZ
  const day = iso.slice(0, 8)
  const region = cfg.region.replace(/^oss-/, '')
  const scope = `${day}/${region}/oss/aliyun_v4_request`

  const query: Record<string, string> = {
    ...(opts.query ?? {}),
    ...(opts.subResources ?? {}),
    'x-oss-credential': `${cfg.accessKeyId}/${scope}`,
    'x-oss-date': iso,
    'x-oss-expires': String(opts.expiresIn ?? 900),
    'x-oss-signature-version': 'OSS4-HMAC-SHA256',
  }
  if (cfg.stsToken) query['x-oss-security-token'] = cfg.stsToken

  const canonicalQuery = Object.keys(query)
    .sort((x, y) => x.localeCompare(y))
    .map((k) => (query[k] === '' ? enc3986(k) : `${enc3986(k)}=${enc3986(query[k])}`))
    .join('&')
  const canonicalHeaders = opts.contentType ? `content-type:${opts.contentType.trim()}\n` : ''
  const canonicalRequest = [
    opts.method,
    enc3986(`/${cfg.bucket}/${opts.key}`).replace(/%2F/g, '/'),
    canonicalQuery,
    canonicalHeaders,
    '',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = ['OSS4-HMAC-SHA256', iso, scope, toHex(sha256(canonicalRequest))].join('\n')

  let key = hmacSha256(`aliyun_v4${cfg.accessKeySecret}`, day)
  key = hmacSha256(key, region)
  key = hmacSha256(key, 'oss')
  key = hmacSha256(key, 'aliyun_v4_request')
  const signature = toHex(hmacSha256(key, stringToSign))

  return `${cfg.host}/${encodeKey(opts.key)}?${canonicalQuery}&x-oss-signature=${signature}`
}

export class OssError extends Error {}

async function explain(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1]
  const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1]
  throw new OssError(`OSS ${res.status}${code ? ` ${code}` : ''}${msg ? `：${msg}` : ''}`)
}

export function putObject(
  cfg: OssConfig,
  key: string,
  body: Blob,
  contentType: string,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const url = signedUrl(cfg, { method: 'PUT', key, contentType })
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText)?.[1]
        reject(new OssError(`上传失败（${xhr.status}${code ? ` ${code}` : ''}）`))
      }
    }
    xhr.onerror = () => reject(new OssError('网络错误：请检查 Bucket 的跨域（CORS）设置'))
    xhr.send(body)
  })
}

export async function getJson<T>(cfg: OssConfig, key: string): Promise<T> {
  const res = await fetch(signedUrl(cfg, { method: 'GET', key }), { cache: 'no-store' })
  if (!res.ok) await explain(res)
  return (await res.json()) as T
}

export async function deleteObject(cfg: OssConfig, key: string): Promise<void> {
  const res = await fetch(signedUrl(cfg, { method: 'DELETE', key }), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) await explain(res)
}

export async function listKeys(cfg: OssConfig, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let marker = ''
  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = { prefix, 'max-keys': '1000' }
    if (marker) query.marker = marker
    const res = await fetch(signedUrl(cfg, { method: 'GET', key: '', query }), { cache: 'no-store' })
    if (!res.ok) await explain(res)
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
    doc.querySelectorAll('Contents > Key').forEach((n) => n.textContent && keys.push(n.textContent))
    const truncated = doc.querySelector('IsTruncated')?.textContent === 'true'
    if (!truncated) break
    marker = doc.querySelector('NextMarker')?.textContent || keys[keys.length - 1] || ''
    if (!marker) break
  }
  return keys
}

export function downloadUrl(cfg: OssConfig, key: string, filename: string): string {
  return signedUrl(cfg, {
    method: 'GET',
    key,
    expiresIn: 3600,
    subResources: {
      'response-content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
