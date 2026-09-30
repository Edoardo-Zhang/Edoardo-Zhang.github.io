// 浏览器端 API 客户端。
// 注意：这里**没有任何密钥** —— 上传用的是后端签发的临时 URL，下载走 /api/download 跳转。
export interface AttachmentMeta {
  name: string
  size: number
  type: string
  key?: string
}

export interface Homework {
  id: string
  subject: string
  items: string[]
  due?: string
  author?: string
  createdAt: number
  files: AttachmentMeta[]
}

export interface NewHomeworkInput {
  subject: string
  items: string[]
  due?: string
  author?: string
  files: File[]
}

export class ApiError extends Error {}

async function fail(res: Response, lead: string): Promise<never> {
  let detail = ''
  try {
    const data = (await res.json()) as { error?: unknown }
    if (typeof data?.error === 'string') detail = data.error
  } catch {
    /* 非 JSON 响应 */
  }
  throw new ApiError(detail || `${lead}（HTTP ${res.status}）`)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) await fail(res, '请求失败')
  return (await res.json()) as T
}

export async function listHomework(): Promise<Homework[]> {
  const res = await fetch('/api/homework', { cache: 'no-store' })
  if (!res.ok) await fail(res, '读取作业失败')
  const data = (await res.json()) as { items?: Homework[] }
  return Array.isArray(data.items) ? data.items : []
}

export interface PreparedUpload {
  key: string
  name: string
  size: number
  type: string
  contentType: string
  url: string
}

/** 第一步：把文件清单交给后端，换回每个文件的临时上传地址。 */
export function prepareUpload(files: { name: string; size: number; type: string }[]) {
  return postJson<{ id: string; prefix: string; uploads: PreparedUpload[] }>('/api/homework/prepare', { files })
}

/** 第二步：文件传完后落库（后端会先确认对象真的存在）。 */
export function commitHomework(payload: {
  id: string
  subject: string
  items: string[]
  due?: string
  author?: string
  files: { name: string; size: number; type: string; key: string }[]
}) {
  return postJson<{ item: Homework }>('/api/homework/commit', payload).then((r) => r.item)
}

/** 失败回滚：删掉这次已经传上去的附件。 */
export async function abortUpload(id: string, keys: string[]): Promise<void> {
  await postJson(`/api/homework/${encodeURIComponent(id)}/abort`, { keys })
}

export async function deleteHomework(id: string): Promise<void> {
  const res = await fetch(`/api/homework/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) await fail(res, '删除失败')
}

/** 下载链接是稳定的本站地址，后端会 302 到短期签名 URL。 */
export function downloadHref(key: string, name: string): string {
  return `/api/download?key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 慢速网络下按体积给足时间：约 10 KB/s 的最坏情况，最少 2 分钟、最多 30 分钟。
const uploadTimeout = (size: number) => Math.min(30 * 60_000, Math.max(120_000, Math.round(size / 10_240) * 1000))

/** 单次 XHR 上传；重试由 withRetry 负责。 */
function putOnce(upload: PreparedUpload, file: Blob, onProgress?: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', upload.url)
    xhr.setRequestHeader('Content-Type', upload.contentType)
    xhr.timeout = uploadTimeout(file.size)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new ApiError(`上传失败（HTTP ${xhr.status}）`))
    }
    xhr.onerror = () => reject(new ApiError('网络错误：上传中断'))
    xhr.ontimeout = () => reject(new ApiError('上传超时：网络不稳定，已中断'))
    xhr.send(file)
  })
}

export interface UploadOptions {
  /** 首次失败后额外重试次数（默认 2，即最多 3 次尝试）。 */
  retries?: number
  /** 每次重试前调用；attempt 是即将进行的第几次尝试（从 2 开始）。 */
  onRetry?: (attempt: number, total: number, error: Error) => void
}

/** 上传一个文件，网络类错误自动重试（4xx 立即失败）。 */
export async function uploadFile(
  upload: PreparedUpload,
  file: File,
  onProgress?: (ratio: number) => void,
  opts: UploadOptions = {},
): Promise<void> {
  const retries = Math.max(0, opts.retries ?? 2)
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await putOnce(upload, file, onProgress)
    } catch (err) {
      last = err
      const permanent = err instanceof ApiError && /HTTP 4\d\d/.test(err.message)
      if (permanent || attempt === retries) break
      const delay = Math.round(Math.min(8000, 600 * 2 ** attempt) * (0.7 + Math.random() * 0.6))
      opts.onRetry?.(attempt + 2, retries + 1, err instanceof Error ? err : new Error(String(err)))
      onProgress?.(0)
      await sleep(delay)
    }
  }
  throw last
}
