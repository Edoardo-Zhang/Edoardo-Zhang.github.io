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
  updatedAt?: number
  /** 开启后学生可以在卡片上交作业。 */
  collect?: boolean
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

/** 修改作业时，为新增附件换取上传地址（沿用原作业 id）。 */
export function prepareUploadFor(id: string, files: { name: string; size: number; type: string }[]) {
  return postJson<{ id: string; prefix: string; uploads: PreparedUpload[] }>(`/api/homework/${encodeURIComponent(id)}/prepare`, { files })
}

/** 保存修改：files 是修改后完整的附件清单（保留的旧附件 + 新上传的）。 */
export async function updateHomework(
  id: string,
  payload: {
    subject: string
    items: string[]
    due?: string
    author?: string
    collect?: boolean
    files: { name: string; size: number; type: string; key: string }[]
  },
): Promise<Homework> {
  const res = await fetch(`/api/homework/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) await fail(res, '保存修改失败')
  return ((await res.json()) as { item: Homework }).item
}

/** 第二步：文件传完后落库（后端会先确认对象真的存在）。 */
export function commitHomework(payload: {
  id: string
  subject: string
  items: string[]
  due?: string
  author?: string
  collect?: boolean
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

// ---------------------------------------------------------------- 登录

export interface SessionUser {
  studentId: string
  name: string
  isAdmin: boolean
}

export const STUDENT_ID_RE = /^\d{10}$/

export async function fetchMe(): Promise<SessionUser | null> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' })
  if (!res.ok) return null
  return ((await res.json()) as { user: SessionUser | null }).user
}

/** 管理员学号首次提交时返回 needPassword，需带上口令再登录一次。 */
export async function login(input: { name: string; studentId: string; password?: string }): Promise<{ user?: SessionUser; needPassword?: boolean }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = (await res.json().catch(() => ({}))) as { user?: SessionUser; needPassword?: boolean; error?: string }
  if (!res.ok) throw Object.assign(new ApiError(data.error || `登录失败（HTTP ${res.status}）`), { needPassword: !!data.needPassword })
  return data
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}

// ---------------------------------------------------------------- 交作业

export interface Submission {
  cardId: string
  studentId: string
  name: string
  version: string
  submittedAt: number
  late: boolean
  files: { name: string; size: number; type: string; key: string }[]
}

export async function fetchMySubmission(cardId: string): Promise<Submission | null> {
  const res = await fetch(`/api/homework/${encodeURIComponent(cardId)}/my-submission`, { cache: 'no-store' })
  if (!res.ok) await fail(res, '读取提交记录失败')
  return ((await res.json()) as { submission: Submission | null }).submission
}

/** 交作业：要上传地址 → 直传 OSS（重试）→ 提交；失败时回滚本次已传的文件。 */
export async function submitHomework(
  cardId: string,
  files: File[],
  onProgress?: (fileIndex: number, ratio: number, attempt: number) => void,
): Promise<Submission> {
  const base = `/api/homework/${encodeURIComponent(cardId)}/submit`
  const prepared = await postJson<{ version: string; uploads: PreparedUpload[] }>(`${base}/prepare`, {
    files: files.map((f) => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' })),
  })
  const uploaded: string[] = []
  try {
    const metas = []
    for (let i = 0; i < files.length; i++) {
      const upload = prepared.uploads[i]
      await uploadFile(upload, files[i], (ratio) => onProgress?.(i, ratio, 1), { onRetry: (attempt) => onProgress?.(i, 0, attempt) })
      uploaded.push(upload.key)
      metas.push({ name: files[i].name, size: files[i].size, type: files[i].type || 'application/octet-stream', key: upload.key })
    }
    const done = await postJson<{ submission: Submission }>(`${base}/commit`, { version: prepared.version, files: metas })
    return done.submission
  } catch (err) {
    if (uploaded.length) await postJson(`${base}/abort`, { version: prepared.version, keys: uploaded }).catch(() => {})
    throw err
  }
}

// ---------------------------------------------------------------- 管理员

export interface StatsRow {
  studentId: string
  name: string
  submittedAt: number
  late: boolean
  versions: number
  files: { name: string; size: number; key: string }[]
}

export interface StatsCard {
  id: string
  subject: string
  due: string | null
  createdAt: number
  submitted: StatsRow[]
  missing: { studentId: string; name: string }[]
  lateCount: number
}

export interface AdminStats {
  rosterSize: number
  cards: StatsCard[]
  generatedAt: number
}

/** 非管理员会抛出 ApiError('暂无权限')。 */
export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await fetch('/api/admin/stats', { cache: 'no-store' })
  if (!res.ok) await fail(res, '读取统计失败')
  return (await res.json()) as AdminStats
}

export const adminFileHref = (key: string, name: string) =>
  `/api/admin/file?key=${encodeURIComponent(key)}&name=${encodeURIComponent(name)}`

export async function unbindStudent(studentId: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(studentId)}`, { method: 'DELETE' })
  if (!res.ok) await fail(res, '解除绑定失败')
}
