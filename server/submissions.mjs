// 收作业：学生提交文件（每次提交是一个新版本，旧版本永不删除），管理员看统计。
// 布局：<prefix>submissions/<cardId>/<studentId>/<version>/{n-rand.ext, meta.json}
//       <prefix>submissions/<cardId>/<studentId>/latest.json   ← 最新一次提交的 meta 副本
import crypto from 'node:crypto'
import { putObject, getJson, deleteObject, objectExists, listKeys, downloadUrl, imageViewUrl, IMAGE_EXT_RE } from './store.mjs'

const VERSION_RE = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/

/** 截止日期 YYYY-MM-DD 视为北京时间当天 23:59:59。 */
export function deadlineOf(due) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due || ''))) return null
  const t = Date.parse(`${due}T23:59:59+08:00`)
  return Number.isFinite(t) ? t : null
}

/**
 * @param {object} deps
 * @param {object} deps.cfg
 * @param {(id: string) => Promise<object|null>} deps.getCard
 * @param {(res, id: string, files: unknown, dirOf: (i:number, ext:string)=>string) => object[]|null} deps.makeUploads
 * @param {() => Promise<object[]>} deps.listUsers
 * @param {() => Promise<object[]>} deps.listCards
 * @param {(studentId: string) => boolean} deps.isAdminId  管理员不计入应交名单
 */
export function createSubmissions({ cfg, getCard, makeUploads, listUsers, listCards, isAdminId }) {
  const root = `${cfg.prefix}submissions/`
  const studentDir = (cardId, studentId) => `${root}${cardId}/${studentId}/`
  const versionDir = (cardId, studentId, version) => `${studentDir(cardId, studentId)}${version}/`
  const fail = (res, status, message) => res.status(status).json({ error: message })

  // 每张卡片的“最新提交”索引缓存；任何提交都会使之失效
  const latestCache = new Map()
  async function latestByStudent(cardId) {
    if (latestCache.has(cardId)) return latestCache.get(cardId)
    const keys = await listKeys(cfg, `${root}${cardId}/`)
    const latestKeys = keys.filter((k) => k.endsWith('/latest.json'))
    const versions = {}
    for (const k of keys) {
      if (!k.endsWith('/meta.json')) continue
      const sid = k.slice(`${root}${cardId}/`.length).split('/')[0]
      versions[sid] = (versions[sid] || 0) + 1
    }
    const metas = await Promise.all(latestKeys.map((k) => getJson(cfg, k).catch(() => null)))
    const map = new Map()
    for (const m of metas) if (m?.studentId) map.set(m.studentId, { ...m, versions: versions[m.studentId] || 1 })
    latestCache.set(cardId, map)
    return map
  }

  async function collectCard(res, id) {
    const card = await getCard(id)
    if (!card) return fail(res, 404, '作业不存在或已被删除'), null
    if (!card.collect) return fail(res, 400, '这份作业没有开启收作业'), null
    return card
  }

  /** 第一步：为本次提交生成版本号与上传地址。 */
  async function prepare(req, res) {
    const card = await collectCard(res, req.params.id)
    if (!card) return
    const files = Array.isArray(req.body?.files) ? req.body.files : []
    if (files.length === 0) return fail(res, 400, '请至少选择一个文件')
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const version = `${stamp}-${crypto.randomBytes(3).toString('hex')}`
    const dir = versionDir(card.id, req.user.studentId, version)
    const uploads = makeUploads(res, card.id, files, (i, ext) => `${dir}${i + 1}-${crypto.randomBytes(6).toString('hex')}${ext}`)
    if (!uploads) return
    res.json({ version, uploads })
  }

  /** 第二步：确认文件都已上传，写 meta.json 和 latest.json。 */
  async function commit(req, res) {
    const card = await collectCard(res, req.params.id)
    if (!card) return
    const version = String(req.body?.version || '')
    if (!VERSION_RE.test(version)) return fail(res, 400, '提交版本号不合法')
    const dir = versionDir(card.id, req.user.studentId, version)
    const raw = Array.isArray(req.body?.files) ? req.body.files : []
    if (raw.length === 0) return fail(res, 400, '请至少选择一个文件')
    const files = []
    for (const f of raw) {
      const key = String(f?.key || '')
      if (!key.startsWith(dir) || key.endsWith('.json')) return fail(res, 400, '文件路径与本次提交不匹配')
      files.push({ name: String(f.name || 'file').slice(0, 200), size: Number(f.size) || 0, type: String(f.type || 'application/octet-stream'), key })
    }
    const missing = []
    for (const f of files) if (!(await objectExists(cfg, f.key))) missing.push(f.name)
    if (missing.length) return fail(res, 400, `这些文件没有上传成功：${missing.join('、')}`)

    const submittedAt = Date.now()
    const deadline = deadlineOf(card.due)
    const meta = {
      cardId: card.id,
      cardSubject: card.subject,
      cardDue: card.due ?? null,
      studentId: req.user.studentId,
      name: req.user.name,
      version,
      submittedAt,
      late: deadline !== null && submittedAt > deadline,
      files,
    }
    await putObject(cfg, `${dir}meta.json`, JSON.stringify(meta), 'application/json')
    await putObject(cfg, `${studentDir(card.id, req.user.studentId)}latest.json`, JSON.stringify(meta), 'application/json')
    latestCache.delete(card.id)
    res.json({ submission: meta })
  }

  /** 失败回滚：只允许删除自己这次版本目录下的文件。 */
  async function abort(req, res) {
    const version = String(req.body?.version || '')
    if (!VERSION_RE.test(version)) return fail(res, 400, '提交版本号不合法')
    const dir = versionDir(String(req.params.id), req.user.studentId, version)
    const keys = (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).filter((k) => k.startsWith(dir) && !k.endsWith('.json'))
    await Promise.allSettled(keys.map((k) => deleteObject(cfg, k)))
    res.json({ ok: true })
  }

  async function mine(req, res) {
    const meta = await getJson(cfg, `${studentDir(String(req.params.id), req.user.studentId)}latest.json`)
    res.json({ submission: meta ?? null })
  }

  /** 管理员统计：每张收作业卡片的已交 / 未交 / 迟交。 */
  async function stats(req, res) {
    const [users, cards] = await Promise.all([listUsers(), listCards()])
    const collectCards = cards.filter((c) => c.collect)
    const roster = users.filter((u) => !isAdminId(u.studentId)).map((u) => ({ studentId: u.studentId, name: u.name }))
    const result = []
    for (const card of collectCards) {
      const latest = await latestByStudent(card.id)
      const submitted = [...latest.values()]
        .sort((a, b) => a.studentId.localeCompare(b.studentId))
        .map((m) => ({
          studentId: m.studentId,
          name: m.name,
          submittedAt: m.submittedAt,
          late: !!m.late,
          versions: m.versions,
          files: m.files.map((f) => ({ name: f.name, size: f.size, key: f.key })),
        }))
      const missing = roster.filter((u) => !latest.has(u.studentId))
      result.push({
        id: card.id,
        subject: card.subject,
        due: card.due ?? null,
        createdAt: card.createdAt,
        submitted,
        missing,
        lateCount: submitted.filter((s) => s.late).length,
      })
    }
    res.json({ rosterSize: roster.length, cards: result, generatedAt: Date.now() })
  }

  function fileLink(req, res) {
    const key = String(req.query.key || '')
    if (!key.startsWith(root) || key.includes('..') || key.endsWith('.json')) return fail(res, 400, 'key 不合法')
    const view = String(req.query.view || '')
    if ((view === 'thumb' || view === 'full') && IMAGE_EXT_RE.test(key)) {
      res.setHeader('Cache-Control', 'private, max-age=1800')
      return res.redirect(302, imageViewUrl(cfg, key, view))
    }
    res.setHeader('Cache-Control', 'no-store')
    res.redirect(302, downloadUrl(cfg, key, String(req.query.name || 'download')))
  }

  return { prepare, commit, abort, mine, stats, fileLink, invalidate: (cardId) => latestCache.delete(cardId) }
}
