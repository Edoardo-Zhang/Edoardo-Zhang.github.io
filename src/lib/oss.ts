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

export class OssError extends Error {
  readonly status: number
  readonly code?: string
  /** 4xx（408/429 除外）是永久错误，重试同一个请求没有意义。status 0 = 网络层失败。 */
  readonly retryable: boolean

  constructor(message: string, status = 0, code?: string) {
    super(message)
    this.name = 'OssError'
    this.status = status
    this.code = code
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
  }
}

const codeRe = /<Code>([^<]+)<\/Code>/

async function explain(res: Response): Promise<never> {
  const text = await res.text().catch(() => '')
  const code = codeRe.exec(text)?.[1]
  const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1]
  throw new OssError(`OSS ${res.status}${code ? ` ${code}` : ''}${msg ? `：${msg}` : ''}`, res.status, code)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface RetryOptions {
  /** 首次失败后额外重试的次数（默认 2，即最多 3 次尝试）。 */
  retries?: number
  /** 每次重试前调用；attempt 是即将进行的第几次尝试（从 2 开始），total 是总尝试次数。 */
  onRetry?: (attempt: number, total: number, error: Error) => void
}

/**
 * 临时故障（网络中断、超时、5xx、429）按指数退避 + 抖动重试，永久错误（4xx）直接抛出。
 * 只用于幂等操作：同一个 key 的 PUT / GET / DELETE 重试不会产生重复对象。
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = Math.max(0, opts.retries ?? 2)
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      last = err
      const retryable = !(err instanceof OssError) || err.retryable
      if (!retryable || attempt === retries) break
      const delay = Math.round(Math.min(8000, 600 * 2 ** attempt) * (0.7 + Math.random() * 0.6))
      opts.onRetry?.(attempt + 2, retries + 1, err instanceof Error ? err : new Error(String(err)))
      await sleep(delay)
    }
  }
  throw last
}

// 慢速网络下按体积给足时间：约 10 KB/s 的最坏情况，最少 2 分钟、最多 30 分钟。
const uploadTimeout = (size: number) => Math.min(30 * 60_000, Math.max(120_000, Math.round(size / 10_240) * 1000))

function putOnce(
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
    xhr.timeout = uploadTimeout(body.size)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else {
        const code = codeRe.exec(xhr.responseText)?.[1]
        reject(new OssError(`上传失败（${xhr.status}${code ? ` ${code}` : ''}）`, xhr.status, code))
      }
    }
    xhr.onerror = () => reject(new OssError('网络错误：请检查网络连接与 Bucket 的跨域（CORS）设置'))
    xhr.ontimeout = () => reject(new OssError('上传超时：网络不稳定，已中断'))
    xhr.send(body)
  })
}

/**
 * 上传一个对象，失败自动重试；每次尝试都会重新签名（旧签名可能已过期）。
 * 注意：重试是整文件重传，不做断点续传。
 */
export function putObject(
  cfg: OssConfig,
  key: string,
  body: Blob,
  contentType: string,
  onProgress?: (ratio: number) => void,
  opts: RetryOptions = {},
): Promise<void> {
  return withRetry(() => putOnce(cfg, key, body, contentType, onProgress), {
    ...opts,
    onRetry: (attempt, total, error) => {
      onProgress?.(0) // 重新开始传，进度条回到 0
      opts.onRetry?.(attempt, total, error)
    },
  })
}

export async function getJson<T>(cfg: OssConfig, key: string): Promise<T> {
  return withRetry(async () => {
    const res = await fetch(signedUrl(cfg, { method: 'GET', key }), { cache: 'no-store' })
    if (!res.ok) await explain(res)
    return (await res.json()) as T
  })
}

export async function deleteObject(cfg: OssConfig, key: string): Promise<void> {
  await withRetry(async () => {
    const res = await fetch(signedUrl(cfg, { method: 'DELETE', key }), { method: 'DELETE' })
    if (!res.ok && res.status !== 404) await explain(res)
  })
}

export async function listKeys(cfg: OssConfig, prefix: string): Promise<string[]> {
  const keys: string[] = []
  let marker = ''
  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = { prefix, 'max-keys': '1000' }
    if (marker) query.marker = marker
    const res = await withRetry(async () => {
      const r = await fetch(signedUrl(cfg, { method: 'GET', key: '', query }), { cache: 'no-store' })
      if (!r.ok) await explain(r)
      return r
    })
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
