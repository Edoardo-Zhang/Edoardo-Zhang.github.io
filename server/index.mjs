// 作业箱后端：静态前端 + 作业 API + OSS 预签名。
// AccessKey 只存在这台服务器的 .env 里，浏览器拿不到。
import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readOssConfig, presign } from './oss.mjs'
import { putObject, getJson, deleteObject, objectExists, listKeys, downloadUrl } from './store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 不引依赖的 .env 加载（已存在的环境变量优先）
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}
loadEnvFile(path.resolve(__dirname, '.env'))

const cfg = readOssConfig()
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 500 * 1024 * 1024)
const MAX_FILES = Number(process.env.MAX_FILES || 20)

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

const ID_RE = /^[a-z0-9]{4,20}-[0-9a-f]{8,32}$/
const newId = () => Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex')
const extOf = (name) => {
  const m = /\.[A-Za-z0-9]{1,10}$/.exec(String(name || ''))
  return m ? m[0].toLowerCase() : ''
}
const filesPrefixOf = (id) => `${cfg.prefix}files/${id}/`
const cardKeyOf = (id) => `${cfg.prefix}cards/${id}.json`
const isHomework = (v) => !!v && typeof v.id === 'string' && typeof v.subject === 'string' && Array.isArray(v.items)
const fail = (res, status, message) => res.status(status).json({ error: message })

app.use((req, res, next) => {
  const t0 = Date.now()
  res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`))
  next()
})

app.get('/api/health', (req, res) => {
  res.json({ ok: true, bucket: cfg.bucket, prefix: cfg.prefix, time: Date.now() })
})

app.get('/api/homework', async (req, res, next) => {
  try {
    const keys = (await listKeys(cfg, `${cfg.prefix}cards/`)).filter((k) => k.endsWith('.json'))
    const loaded = await Promise.all(keys.map((k) => getJson(cfg, k).catch(() => null)))
    const items = loaded.filter(isHomework)
    items.sort((a, b) => b.createdAt - a.createdAt)
    res.json({ items })
  } catch (err) {
    next(err)
  }
})

// 第一步：按文件清单生成 id 与每个文件的预签名上传地址（浏览器直传 OSS，不经过本服务器）
app.post('/api/homework/prepare', async (req, res, next) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : []
    if (files.length === 0) return fail(res, 400, '没有要上传的文件')
    if (files.length > MAX_FILES) return fail(res, 400, `一次最多上传 ${MAX_FILES} 个文件`)
    for (const f of files) {
      if (typeof f?.name !== 'string' || !f.name.trim()) return fail(res, 400, '文件信息不完整')
      if (Number(f.size) > MAX_FILE_BYTES) return fail(res, 400, `单个文件不能超过 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB`)
    }
    const id = newId()
    const uploads = files.map((f, i) => {
      const type = typeof f.type === 'string' && f.type ? f.type : 'application/octet-stream'
      const key = `${filesPrefixOf(id)}${i + 1}-${newId()}${extOf(f.name)}`
      return {
        key,
        name: String(f.name),
        size: Number(f.size) || 0,
        type,
        contentType: type,
        url: presign(cfg, { method: 'PUT', key, contentType: type, expiresIn: 900 }),
      }
    })
    res.json({ id, prefix: cfg.prefix, uploads })
  } catch (err) {
    next(err)
  }
})

// 第二步：文件都传完后写作业卡片。会先确认每个对象真的存在。
app.post('/api/homework/commit', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const id = String(body.id || '')
    if (!ID_RE.test(id)) return fail(res, 400, 'id 不合法')
    const subject = String(body.subject || '').trim()
    const items = (Array.isArray(body.items) ? body.items : []).map((s) => String(s).trim()).filter(Boolean)
    if (!subject) return fail(res, 400, '请填写科目')
    if (items.length === 0) return fail(res, 400, '请至少填写一项作业内容')
    const files = Array.isArray(body.files) ? body.files : []
    if (files.length > MAX_FILES) return fail(res, 400, '附件数量超出限制')
    const prefix = filesPrefixOf(id)
    const cleaned = []
    for (const f of files) {
      const key = String(f?.key || '')
      if (!key.startsWith(prefix)) return fail(res, 400, '附件路径与作业 id 不匹配')
      cleaned.push({ name: String(f.name || 'file'), size: Number(f.size) || 0, type: String(f.type || 'application/octet-stream'), key })
    }
    const missing = []
    for (const f of cleaned) if (!(await objectExists(cfg, f.key))) missing.push(f.name)
    if (missing.length) return fail(res, 400, `这些附件没有上传成功：${missing.join('、')}`)

    const hw = {
      id,
      subject,
      items,
      due: body.due ? String(body.due) : undefined,
      author: body.author ? String(body.author).trim() || undefined : undefined,
      createdAt: Date.now(),
      files: cleaned,
    }
    await putObject(cfg, cardKeyOf(id), JSON.stringify(hw), 'application/json')
    res.json({ item: hw })
  } catch (err) {
    next(err)
  }
})

// 失败回滚：删掉本次已上传的附件（只允许删本 id 目录下的）
app.post('/api/homework/:id/abort', async (req, res, next) => {
  try {
    const id = String(req.params.id || '')
    if (!ID_RE.test(id)) return fail(res, 400, 'id 不合法')
    const prefix = filesPrefixOf(id)
    const keys = (Array.isArray(req.body?.keys) ? req.body.keys : []).map(String).filter((k) => k.startsWith(prefix))
    const results = await Promise.allSettled(keys.map((k) => deleteObject(cfg, k)))
    res.json({ ok: true, deleted: results.filter((r) => r.status === 'fulfilled').length, skipped: keys.length - results.length })
  } catch (err) {
    next(err)
  }
})

app.delete('/api/homework/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id || '')
    if (!ID_RE.test(id)) return fail(res, 400, 'id 不合法')
    const card = await getJson(cfg, cardKeyOf(id))
    await deleteObject(cfg, cardKeyOf(id))
    const prefix = filesPrefixOf(id)
    const keys = (card?.files ?? []).map((f) => String(f?.key || '')).filter((k) => k.startsWith(prefix))
    await Promise.allSettled(keys.map((k) => deleteObject(cfg, k)))
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// 下载：校验 key 在前缀内，302 到短期签名链接（链接不会暴露 AccessKey）
app.get('/api/download', (req, res, next) => {
  try {
    const key = String(req.query.key || '')
    if (!key.startsWith(cfg.prefix) || key.includes('..')) return fail(res, 400, 'key 不合法')
    res.setHeader('Cache-Control', 'no-store')
    res.redirect(302, downloadUrl(cfg, key, String(req.query.name || 'download')))
  } catch (err) {
    next(err)
  }
})

app.use('/api', (req, res) => fail(res, 404, '接口不存在'))

const distDir = path.resolve(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: 'index.html', maxAge: '1h', setHeaders: (res, file) => {
    if (file.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
  } }))
} else {
  console.warn('注意：未找到前端构建产物 dist/，只提供 API')
}

app.use((err, req, res, _next) => {
  console.error('ERROR', req.method, req.path, err?.message)
  res.status(err?.status || 500).json({ error: err?.message || '服务器内部错误' })
})

app.listen(PORT, HOST, () => {
  console.log(`作业箱后端已启动 http://${HOST}:${PORT}  存储=${cfg.bucket}/${cfg.prefix}`)
})
