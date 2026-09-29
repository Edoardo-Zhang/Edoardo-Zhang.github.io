import { deleteObject, getJson, listKeys, ossConfig, putObject } from './oss'

export interface AttachmentMeta {
  name: string
  size: number
  type: string
  key?: string // OSS object key; absent when stored locally (OSS not configured)
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

export interface NewHomework {
  subject: string
  items: string[]
  due?: string
  author?: string
  files: File[]
}

export const storageMode: 'oss' | 'local' = ossConfig ? 'oss' : 'local'
export const storageLabel = ossConfig ? `阿里云 OSS · ${ossConfig.bucket}` : '本机存储（未配置 OSS）'

const LOCAL_KEY = 'zuoyexiang.homework.v1'
const MINE_KEY = 'zuoyexiang.mine.v1'
export const MAX_FILE_BYTES = 500 * 1024 * 1024

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable (private mode) — ignore */
  }
}

export const isMine = (id: string) => safeGet<string[]>(MINE_KEY, []).includes(id)
const rememberMine = (id: string) => safeSet(MINE_KEY, [...safeGet<string[]>(MINE_KEY, []), id])

function newId() {
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(16).slice(2, 14)
  // Time-first ids sort chronologically in OSS listings.
  return `${Date.now().toString(36)}-${rand}`
}

function extOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name)
  return m ? `.${m[1].toLowerCase()}` : ''
}

function isHomework(v: unknown): v is Homework {
  const h = v as Homework
  return !!h && typeof h.id === 'string' && typeof h.subject === 'string' && Array.isArray(h.items)
}

export async function loadHomework(): Promise<Homework[]> {
  let list: Homework[]
  if (ossConfig) {
    const cfg = ossConfig
    const keys = (await listKeys(cfg, `${cfg.prefix}cards/`)).filter((k) => k.endsWith('.json'))
    const results = await Promise.allSettled(keys.map((k) => getJson<Homework>(cfg, k)))
    list = results.flatMap((r) => (r.status === 'fulfilled' && isHomework(r.value) ? [r.value] : []))
  } else {
    list = safeGet<Homework[]>(LOCAL_KEY, []).filter(isHomework)
  }
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

export async function createHomework(
  input: NewHomework,
  onProgress?: (fileIndex: number, ratio: number) => void,
): Promise<Homework> {
  const id = newId()
  const files: AttachmentMeta[] = []

  if (ossConfig) {
    const cfg = ossConfig
    for (let i = 0; i < input.files.length; i++) {
      const f = input.files[i]
      const type = f.type || 'application/octet-stream'
      // ASCII-only object keys; the original filename lives in the card JSON.
      const key = `${cfg.prefix}files/${id}/${i + 1}-${newId()}${extOf(f.name)}`
      await putObject(cfg, key, f, type, (r) => onProgress?.(i, r))
      files.push({ name: f.name, size: f.size, type, key })
    }
  } else {
    input.files.forEach((f) => files.push({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' }))
  }

  const hw: Homework = {
    id,
    subject: input.subject.trim(),
    items: input.items.map((s) => s.trim()).filter(Boolean),
    due: input.due || undefined,
    author: input.author?.trim() || undefined,
    createdAt: Date.now(),
    files,
  }

  if (ossConfig) {
    const blob = new Blob([JSON.stringify(hw)], { type: 'application/json' })
    await putObject(ossConfig, `${ossConfig.prefix}cards/${id}.json`, blob, 'application/json')
  } else {
    safeSet(LOCAL_KEY, [hw, ...safeGet<Homework[]>(LOCAL_KEY, [])])
  }
  rememberMine(id)
  return hw
}

export async function removeHomework(hw: Homework): Promise<void> {
  if (ossConfig) {
    const cfg = ossConfig
    await deleteObject(cfg, `${cfg.prefix}cards/${hw.id}.json`)
    await Promise.allSettled(hw.files.filter((f) => f.key).map((f) => deleteObject(cfg, f.key!)))
  } else {
    safeSet(
      LOCAL_KEY,
      safeGet<Homework[]>(LOCAL_KEY, []).filter((h) => h.id !== hw.id),
    )
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`
}

export function fileKind(meta: { name: string; type: string }) {
  const ext = extOf(meta.name).slice(1).toUpperCase()
  if (ext) return ext
  const sub = meta.type.split('/')[1]
  return sub ? sub.toUpperCase().slice(0, 6) : 'FILE'
}

export function formatDate(ts: number) {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
