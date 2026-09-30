// 作业数据层：所有读写都走本站后端 API，前端不接触 OSS 凭证。
import {
  abortUpload,
  commitHomework,
  deleteHomework,
  downloadHref,
  listHomework,
  prepareUpload,
  prepareUploadFor,
  updateHomework,
  uploadFile,
  type AttachmentMeta,
  type Homework,
} from './api'

export type { AttachmentMeta, Homework }

export const MAX_FILE_BYTES = 500 * 1024 * 1024

export const storageLabel = '班级服务器'

const MINE_KEY = 'zuoyexiang.mine.v2'

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
    /* 隐私模式等场景忽略 */
  }
}

export const isMine = (id: string) => safeGet<string[]>(MINE_KEY, []).includes(id)
const rememberMine = (id: string) => safeSet(MINE_KEY, [...safeGet<string[]>(MINE_KEY, []), id])

export async function loadHomework(): Promise<Homework[]> {
  return listHomework()
}

/**
 * 发布一份作业：先向后端要上传地址 → 直传 OSS（带进度、失败重试）→ 落库。
 * 任何一步失败都会回滚本次已上传的附件，桶里不留孤儿文件。
 * onProgress 的第三参是当前是第几次上传尝试（>1 表示正在重试）。
 */
export async function createHomework(
  input: {
    subject: string
    items: string[]
    due?: string
    author?: string
    files: File[]
  },
  onProgress?: (fileIndex: number, ratio: number, attempt: number) => void,
): Promise<Homework> {
  const prepared = await prepareUpload(input.files.map((f) => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' })))
  const uploaded: string[] = []
  const metas: { name: string; size: number; type: string; key: string }[] = []
  try {
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i]
      const upload = prepared.uploads[i]
      await uploadFile(upload, file, (ratio) => onProgress?.(i, ratio, 1), {
        onRetry: (attempt) => onProgress?.(i, 0, attempt),
      })
      uploaded.push(upload.key)
      metas.push({ name: file.name, size: file.size, type: file.type || 'application/octet-stream', key: upload.key })
    }
    const item = await commitHomework({
      id: prepared.id,
      subject: input.subject,
      items: input.items,
      due: input.due || undefined,
      author: input.author || undefined,
      files: metas,
    })
    rememberMine(item.id)
    return item
  } catch (err) {
    try {
      await abortUpload(prepared.id, uploaded)
    } catch {
      /* 回滚失败不该掩盖真正的错误 */
    }
    throw err
  }
}

/**
 * 修改一份作业：只上传新增的附件，然后提交完整清单（保留的旧附件 + 新附件）。
 * 后端写入成功后才删除被移除的旧附件；本次新传的附件在失败时回滚。
 */
export async function editHomework(
  hw: Homework,
  input: {
    subject: string
    items: string[]
    due?: string
    author?: string
    keep: AttachmentMeta[]
    files: File[]
  },
  onProgress?: (fileIndex: number, ratio: number, attempt: number) => void,
): Promise<Homework> {
  const uploaded: string[] = []
  const metas: { name: string; size: number; type: string; key: string }[] = input.keep
    .filter((f): f is AttachmentMeta & { key: string } => !!f.key)
    .map((f) => ({ name: f.name, size: f.size, type: f.type, key: f.key }))
  try {
    if (input.files.length) {
      const prepared = await prepareUploadFor(
        hw.id,
        input.files.map((f) => ({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' })),
      )
      for (let i = 0; i < input.files.length; i++) {
        const file = input.files[i]
        const upload = prepared.uploads[i]
        await uploadFile(upload, file, (ratio) => onProgress?.(i, ratio, 1), {
          onRetry: (attempt) => onProgress?.(i, 0, attempt),
        })
        uploaded.push(upload.key)
        metas.push({ name: file.name, size: file.size, type: file.type || 'application/octet-stream', key: upload.key })
      }
    }
    return await updateHomework(hw.id, {
      subject: input.subject,
      items: input.items,
      due: input.due || undefined,
      author: input.author || undefined,
      files: metas,
    })
  } catch (err) {
    if (uploaded.length) {
      try {
        await abortUpload(hw.id, uploaded)
      } catch {
        /* 回滚失败不该掩盖真正的错误 */
      }
    }
    throw err
  }
}

export async function removeHomework(hw: Homework): Promise<void> {
  await deleteHomework(hw.id)
}

export { downloadHref }

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

function extOf(name: string) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name)
  return m ? `.${m[1].toLowerCase()}` : ''
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
