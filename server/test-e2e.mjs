// 端到端测试：对着真实 OSS 跑完整流程（发布 → 上传 → 提交 → 列表 → 下载 → 回滚 → 删除）
const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const out = {}
let pass = 0, failCount = 0
const check = (name, ok, extra) => {
  out[name] = ok ? 'PASS' + (extra ? ' ' + extra : '') : 'FAIL ' + (extra ?? '')
  ok ? pass++ : failCount++
}
const api = async (p, init) => {
  const res = await fetch(BASE + p, init)
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
  return { status: res.status, body, headers: res.headers }
}
const put = async (u, content, type) => (await fetch(u, { method: 'PUT', headers: { 'Content-Type': type }, body: content })).status

// 0) 健康检查
const health = await api('/api/health')
check('health', health.status === 200 && health.body?.ok === true, JSON.stringify(health.body))

// 1) 列表（应包含已有卡片）
const before = await api('/api/homework')
check('list-before', before.status === 200 && Array.isArray(before.body.items), 'items=' + (before.body.items?.length ?? '?'))
const beforeKeys = new Set(before.body.items.map((i) => i.id))

// 2) 正常发布：2 个附件
const prep = await api('/api/homework/prepare', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files: [{ name: 'dsh-e2e-a.txt', size: 11, type: 'text/plain' }, { name: 'dsh-e2e-b.txt', size: 7, type: 'text/plain' }] }),
})
check('prepare', prep.status === 200 && prep.body.uploads?.length === 2 && !!prep.body.id, 'id=' + prep.body.id)
const uploads = prep.body.uploads ?? []
const putStatuses = []
for (let i = 0; i < uploads.length; i++) putStatuses.push(await put(uploads[i].url, i === 0 ? 'hello world' : 'second!', uploads[i].contentType))
check('upload-to-oss', putStatuses.every((s) => s === 200), 'status=' + putStatuses.join(','))

const id = prep.body.id
const commit = await api('/api/homework/commit', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, subject: '后端自测', items: ['验证 API'], author: 'dsh', files: uploads.map((u) => ({ name: u.name, size: u.size, type: u.type, key: u.key })) }),
})
check('commit', commit.status === 200 && commit.body.item?.id === id, 'files=' + (commit.body.item?.files?.length ?? '?'))

const after = await api('/api/homework')
check('list-after-has-item', after.body.items.some((i) => i.id === id), 'items=' + after.body.items.length)

// 3) 下载（302 到签名链接）
const dl = await fetch(BASE + '/api/download?key=' + encodeURIComponent(uploads[0].key) + '&name=' + encodeURIComponent('a.txt'), { redirect: 'manual' })
const dlUrl = dl.headers.get('location')
const dlBody = dlUrl ? await (await fetch(dlUrl)).text() : ''
check('download', dl.status === 302 && dlBody === 'hello world', 'status=' + dl.status + ' body=' + dlBody)

// 4) 安全边界：前缀外的 key 必须被拒
const badDl = await api('/api/download?key=' + encodeURIComponent('cards/../secret.txt'))
check('reject-outside-key', badDl.status === 400, 'status=' + badDl.status)
const badCommit = await api('/api/homework/commit', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id, subject: 'x', items: ['y'], files: [{ name: 'z', key: 'zuoyexiang/files/other-id/1-x.txt' }] }),
})
check('reject-mismatched-key', badCommit.status === 400, 'status=' + badCommit.status)

// 5) 失败回滚：prepare 了但不传文件 → commit 必须失败，abort 后无残留
const prep2 = await api('/api/homework/prepare', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ files: [{ name: 'never-uploaded.txt', size: 5, type: 'text/plain' }] }),
})
const commit2 = await api('/api/homework/commit', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: prep2.body.id, subject: 'x', items: ['y'], files: [{ name: 'never-uploaded.txt', size: 5, type: 'text/plain', key: prep2.body.uploads[0].key }] }),
})
check('commit-detects-missing-file', commit2.status === 400, 'status=' + commit2.status + ' msg=' + commit2.body.error)
const abort = await api('/api/homework/' + prep2.body.id + '/abort', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: prep2.body.uploads.map((u) => u.key) }),
})
check('abort', abort.status === 200 && abort.body.ok === true)

// 6) 删除
const del = await api('/api/homework/' + id, { method: 'DELETE' })
check('delete', del.status === 200 && del.body.ok === true)
const final = await api('/api/homework')
const finalKeys = new Set(final.body.items.map((i) => i.id))
check('list-restored', finalKeys.size === beforeKeys.size && [...beforeKeys].every((k) => finalKeys.has(k)), 'items=' + final.body.items.length)

console.log(JSON.stringify(out, null, 2))
console.log('\n通过 ' + pass + ' / 失败 ' + failCount)
process.exitCode = failCount ? 1 : 0
