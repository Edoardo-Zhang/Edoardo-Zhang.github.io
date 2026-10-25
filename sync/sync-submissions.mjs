// 把学生交的作业从阿里云 OSS 同步到本机文件夹。
// - **只要每人最新一次提交**：重交直接覆盖，不再保留版本文件夹
// - 结构：<科目_截止日期_卡片id后6位>\<学号>_<姓名>_<原文件名>  +  提交汇总.csv
// - 增量：已下载且大小一致的文件跳过；本地被删掉的会重新下载
// - 安全写入：先下到 .part，校验大小后再改名；中途断网下次重来
// - 只删「本机多余的上一次提交文件」（OSS 上永不删除，随时可重下）
// - 离线时记录日志后退出，下次运行自动补齐
// 用法：node sync/sync-submissions.mjs   （由计划任务定时运行，见 scripts/install-sync-task.ps1）
// 环境变量：SYNC_DIR（默认 D:\作业箱收件）；OSS 配置读取 server/.env。
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { readOssConfig, presign } from '../server/oss.mjs'
import { getJson, listKeys } from '../server/store.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
for (const line of fs.existsSync(path.join(here, '..', 'server', '.env')) ? fs.readFileSync(path.join(here, '..', 'server', '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
  if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
}

const DIR = process.env.SYNC_DIR || 'D:\\作业箱收件'
const MANIFEST = path.join(DIR, '_manifest.json')
const LOG = path.join(DIR, '_sync.log')
const LOCK = path.join(DIR, '_sync.lock')
const adminIds = new Set(String(process.env.ADMIN_STUDENT_IDS || '').split(/[,\s]+/).filter(Boolean))

fs.mkdirSync(DIR, { recursive: true })

function log(msg) {
  const line = `${new Date().toLocaleString('zh-CN', { hour12: false })}  ${msg}`
  console.log(line)
  fs.appendFileSync(LOG, line + '\n')
}

/** Windows 文件名清洗：去掉非法字符与结尾的点/空格。 */
const safe = (s, max = 80) =>
  String(s ?? '')
    // eslint-disable-next-line no-control-regex -- Windows 文件名不允许控制字符
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, max) || '_'

const stamp = (t) => {
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

// ---- 防止两个同步同时跑（计划任务重叠时） ----
try {
  const st = fs.statSync(LOCK)
  if (Date.now() - st.mtimeMs < 2 * 3600_000) {
    log('上一次同步仍在进行，本次跳过。')
    process.exit(0)
  }
} catch {
  /* 没有锁 */
}
fs.writeFileSync(LOCK, String(process.pid))
const release = () => {
  try {
    fs.unlinkSync(LOCK)
  } catch {
    /* ignore */
  }
}

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { cards: {}, files: {} }
const saveManifest = () => {
  fs.writeFileSync(MANIFEST + '.tmp', JSON.stringify(manifest, null, 2))
  fs.renameSync(MANIFEST + '.tmp', MANIFEST)
}

async function download(cfg, key, dest, size) {
  const part = dest + '.part'
  const res = await fetch(presign(cfg, { method: 'GET', key, expiresIn: 3600 }))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part))
  const got = fs.statSync(part).size
  if (got !== size) throw new Error(`大小不符（应为 ${size}，实际 ${got}）`)
  fs.renameSync(part, dest)
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`


async function main() {
  const cfg = readOssConfig()
  const root = `${cfg.prefix}submissions/`

  let keys
  try {
    keys = await listKeys(cfg, root)
  } catch (err) {
    log(`无法连接 OSS（${err.message}），可能未联网，下次再同步。`)
    return 2
  }

  const metaKeys = keys.filter((k) => k.endsWith('/meta.json'))
  const users = (await Promise.all((await listKeys(cfg, `${cfg.prefix}users/`)).filter((k) => k.endsWith('.json')).map((k) => getJson(cfg, k).catch(() => null))))
    .filter((u) => u?.studentId && !adminIds.has(u.studentId))

  let fetched = 0
  let skipped = 0
  let failed = 0
  let cleaned = 0

  // 只保留每人「最新一次提交」：同一学号多次提交只落最新那份，重交即覆盖
  const latestByCard = new Map()
  const countsByCard = new Map()
  for (const mk of metaKeys) {
    const meta = await getJson(cfg, mk).catch(() => null)
    if (!meta?.cardId || !Array.isArray(meta.files)) continue
    // 卡片文件夹名第一次见到时固定，之后卡片改名也不会把文件拆到两处
    manifest.cards[meta.cardId] ??= safe(`${meta.cardSubject || '未命名'}_${meta.cardDue || '无截止'}_${meta.cardId.slice(-6)}`)
    if (!latestByCard.has(meta.cardId)) latestByCard.set(meta.cardId, new Map())
    const perStudent = latestByCard.get(meta.cardId)
    const prev = perStudent.get(meta.studentId)
    if (!prev || prev.submittedAt < meta.submittedAt) perStudent.set(meta.studentId, meta)
    // 提交次数（汇总表用）
    if (!countsByCard.has(meta.cardId)) countsByCard.set(meta.cardId, new Map())
    const c = countsByCard.get(meta.cardId)
    c.set(meta.studentId, (c.get(meta.studentId) || 0) + 1)
  }

  // 平铺：<卡片目录>\<学号>_<姓名>_<原文件名>；重交覆盖上一版
  for (const [cardId, perStudent] of latestByCard) {
    const cardDir = path.join(DIR, manifest.cards[cardId])
    fs.mkdirSync(cardDir, { recursive: true })

    for (const [studentId, meta] of perStudent) {
      const who = safe(`${studentId}_${meta.name}`)
      const keep = new Set()
      const used = new Set()
      let studentFailed = 0

      for (const f of meta.files) {
        let name = safe(f.name, 120)
        for (let n = 2; used.has(name.toLowerCase()); n++) name = safe(`${n}-${f.name}`, 120)
        used.add(name.toLowerCase())

        const fileName = `${who}_${name}`
        const dest = path.join(cardDir, fileName)
        keep.add(fileName.toLowerCase())

        const rec = manifest.files[f.key]
        const localOk = fs.existsSync(dest) && fs.statSync(dest).size === f.size
        const sameTarget = rec && path.resolve(rec.path) === path.resolve(dest) && rec.size === f.size
        if (localOk && sameTarget) {
          skipped++
          continue
        }
        try {
          await download(cfg, f.key, dest, f.size) // 先写 .part 校验大小再改名，覆盖旧文件
          manifest.files[f.key] = { path: dest, size: f.size, at: Date.now() }
          fetched++
          log(`已下载 ${path.relative(DIR, dest)}${meta.late ? '（迟交）' : ''}`)
        } catch (err) {
          studentFailed++
          failed++
          log(`下载失败 ${f.key}：${err.message}（下次重试）`)
        }
      }

      // 这位同学上一版的文件如果这次没出现在提交里，删掉（OSS 上永不删除，随时可重下）
      try {
        for (const entry of fs.readdirSync(cardDir)) {
          const low = entry.toLowerCase()
          if (low.startsWith(`${who.toLowerCase()}_`) && !keep.has(low)) {
            fs.unlinkSync(path.join(cardDir, entry))
            cleaned++
            log(`已清理旧版本文件 ${entry}`)
          }
        }
      } catch {
        /* 清理失败不影响同步 */
      }

      // 迁移：删掉旧版布局留下的「学号_姓名\时间\文件」目录（内容已被上面的平铺文件取代）
      const legacyDir = path.join(cardDir, who)
      if (studentFailed === 0 && fs.existsSync(legacyDir)) {
        try {
          fs.rmSync(legacyDir, { recursive: true, force: true })
          cleaned++
          log(`已移除旧版目录 ${path.relative(DIR, legacyDir)}`)
        } catch {
          /* ignore */
        }
      }

      saveManifest()
    }
  }

  // 每张卡片写一份汇总（以每人最新一次提交为准）
  for (const [cardId, perStudent] of latestByCard) {
    const counts = countsByCard.get(cardId) ?? new Map()
    const rows = [['学号', '姓名', '状态', '最后提交时间', '是否迟交', '提交次数', '文件']]
    for (const m of [...perStudent.values()].sort((a, b) => a.studentId.localeCompare(b.studentId)))
      rows.push(['\t' + m.studentId, m.name, '已交', stamp(m.submittedAt), m.late ? '是' : '否', counts.get(m.studentId) || 1, m.files.map((f) => f.name).join('; ')])
    for (const u of users.filter((u) => !perStudent.has(u.studentId)).sort((a, b) => a.studentId.localeCompare(b.studentId)))
      rows.push(['\t' + u.studentId, u.name, '未交', '', '', 0, ''])
    const file = path.join(DIR, manifest.cards[cardId], '提交汇总.csv')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'))
  }

  log(`同步完成：新下载 ${fetched} 个，已有 ${skipped} 个，失败 ${failed} 个，清理 ${cleaned} 项。`)
  return failed ? 1 : 0
}
let code = 0
try {
  code = await main()
} catch (err) {
  log(`同步出错：${err?.message || err}（下次重试）`)
  code = 1
} finally {
  release()
}
process.exit(code)
