// 登录与权限：姓名 + 10 位学号即可登录；管理员学号另需口令。
// 会话是 HMAC 签名的 Cookie（服务器不存会话），用户名册存在 OSS 的 users/ 下。
import crypto from 'node:crypto'
import { getJson, putObject, listKeys, deleteObject } from './store.mjs'

export const STUDENT_ID_RE = /^\d{10}$/
const COOKIE = 'zyx_session'
const SESSION_DAYS = 30
const NAME_MAX = 20

const b64url = (buf) => Buffer.from(buf).toString('base64url')

/** 生成管理员口令哈希：scrypt$<salt>$<hash>（供 scripts/hash-admin-password.mjs 使用）。 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(password), salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored || '').split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length)
  return crypto.timingSafeEqual(expected, actual)
}

function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/**
 * @param {object} cfg  OSS 配置（readOssConfig 的返回值）
 * @param {NodeJS.ProcessEnv} env
 */
export function createAuth(cfg, env = process.env) {
  const adminIds = new Set(
    String(env.ADMIN_STUDENT_IDS || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => STUDENT_ID_RE.test(s)),
  )
  const adminHash = String(env.ADMIN_PASSWORD_HASH || '').trim()
  let secret = String(env.SESSION_SECRET || '').trim()
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    console.warn('注意：未设置 SESSION_SECRET，已临时生成；服务重启后所有人需要重新登录。')
  }
  if (adminIds.size && !adminHash) console.warn('注意：设置了 ADMIN_STUDENT_IDS 但没有 ADMIN_PASSWORD_HASH，管理员将无法登录。')
  // 本机开发（http://localhost）以外一律加 Secure
  const insecureCookie = env.COOKIE_INSECURE === '1'

  const userKeyOf = (studentId) => `${cfg.prefix}users/${studentId}.json`
  const sign = (data) => b64url(crypto.createHmac('sha256', secret).update(data).digest())

  function issue(res, user) {
    const payload = b64url(JSON.stringify({ ...user, exp: Date.now() + SESSION_DAYS * 86400_000 }))
    const value = `${payload}.${sign(payload)}`
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${insecureCookie ? '' : '; Secure'}`,
    )
  }

  function clear(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${insecureCookie ? '' : '; Secure'}`)
  }

  /** 解析并校验 Cookie；无效返回 null。管理员身份以服务器当前配置为准（撤销即时生效）。 */
  function readSession(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE]
    if (!raw) return null
    const [payload, mac] = raw.split('.')
    if (!payload || !mac) return null
    const expected = sign(payload)
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
    try {
      const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      if (!s || typeof s.exp !== 'number' || s.exp < Date.now() || !STUDENT_ID_RE.test(s.studentId)) return null
      return { studentId: s.studentId, name: String(s.name), isAdmin: !!s.isAdmin && adminIds.has(s.studentId) }
    } catch {
      return null
    }
  }

  // ---- 名册缓存（统计“未交名单”要用到全部用户） ----
  let usersCache = null
  async function listUsers() {
    if (usersCache) return usersCache
    const keys = (await listKeys(cfg, `${cfg.prefix}users/`)).filter((k) => k.endsWith('.json'))
    const loaded = await Promise.all(keys.map((k) => getJson(cfg, k).catch(() => null)))
    usersCache = loaded.filter((u) => u && STUDENT_ID_RE.test(u.studentId)).sort((a, b) => a.studentId.localeCompare(b.studentId))
    return usersCache
  }

  // ---- 登录限流：只统计失败的尝试（每个 IP 每分钟最多 20 次）。
  // 全班常在同一个校园网出口 IP 后面，正常登录一律不计数，否则上课时会互相挡住。
  const failures = new Map()
  const recentFailures = (ip) => (failures.get(ip) || []).filter((t) => Date.now() - t < 60_000)
  function recordFailure(ip) {
    const list = recentFailures(ip)
    list.push(Date.now())
    failures.set(ip, list)
    if (failures.size > 5000) failures.clear()
  }

  async function login(req, res) {
    const ip = req.ip || 'unknown'
    if (recentFailures(ip).length >= 20) return res.status(429).json({ error: '尝试太频繁，请一分钟后再试' })
    const reject = (status, body) => {
      recordFailure(ip)
      return res.status(status).json(body)
    }
    const name = String(req.body?.name ?? '').trim()
    const studentId = String(req.body?.studentId ?? '').trim()
    const password = req.body?.password
    if (!STUDENT_ID_RE.test(studentId)) return reject(400, { error: '学号须为 10 位数字' })
    if (!name) return reject(400, { error: '请填写姓名' })
    if (name.length > NAME_MAX) return reject(400, { error: `姓名不能超过 ${NAME_MAX} 个字` })

    const isAdmin = adminIds.has(studentId)
    if (isAdmin) {
      if (!adminHash) return res.status(503).json({ error: '管理员口令尚未设置：请在服务器上运行 node scripts/setup-admin.mjs <学号> 后重启后端' })
      if (password === undefined || password === null || password === '') return res.json({ needPassword: true })
      if (!adminHash || !verifyPassword(password, adminHash)) return reject(401, { error: '管理员口令不正确', needPassword: true })
    }

    // 首次登录把姓名绑定到学号；之后同一学号必须用同一姓名
    const key = userKeyOf(studentId)
    const existing = await getJson(cfg, key)
    if (existing && existing.name !== name) {
      return reject(409, { error: '该学号已用其他姓名登录过。如果是你本人，请联系管理员处理。' })
    }
    const now = Date.now()
    const user = { studentId, name, firstLoginAt: existing?.firstLoginAt ?? now, lastLoginAt: now }
    await putObject(cfg, key, JSON.stringify(user), 'application/json')
    if (!existing) usersCache = null

    const session = { studentId, name, isAdmin }
    issue(res, session)
    res.json({ user: session })
  }

  const requireUser = (req, res, next) => {
    const user = readSession(req)
    if (!user) return res.status(401).json({ error: '请先登录' })
    req.user = user
    next()
  }

  const requireAdmin = (req, res, next) => {
    const user = readSession(req)
    if (!user) return res.status(401).json({ error: '请先登录' })
    if (!user.isAdmin) {
      // 管理员学号但会话不是管理员（例如在设为管理员之前登录的）：提示重新登录验证口令
      if (adminIds.has(user.studentId)) return res.status(403).json({ error: '请退出后重新登录，并输入管理员口令' })
      return res.status(403).json({ error: '暂无权限' })
    }
    req.user = user
    next()
  }

  /** 管理员解除某学号的姓名绑定（同学首次登录打错名字时用）。 */
  async function unbindUser(studentId) {
    if (!STUDENT_ID_RE.test(studentId)) return false
    await deleteObject(cfg, userKeyOf(studentId))
    usersCache = null
    return true
  }

  return { login, readSession, clear, requireUser, requireAdmin, listUsers, unbindUser, isAdminId: (id) => adminIds.has(id) }
}
