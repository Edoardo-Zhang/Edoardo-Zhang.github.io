// 端到端测试：登录 / 权限 / 收作业 / 统计。对着真实 OSS 跑，请让后端使用独立前缀（如 OSS_PREFIX=zuoyexiang/_test/）。
// 用法：BASE=http://127.0.0.1:3010 ADMIN_ID=9999999999 ADMIN_PASSWORD=... node test-auth.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:3010'
const ADMIN_ID = process.env.ADMIN_ID || '9999999999'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const results = {}
let pass = 0
let failed = 0
const check = (name, ok, extra = '') => {
  results[name] = `${ok ? 'PASS' : 'FAIL'}${extra ? ' ' + extra : ''}`
  if (ok) pass++
  else failed++
}

/** 带 Cookie 的极简客户端，模拟一个浏览器。 */
function client() {
  let cookie = ''
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0]
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text.slice(0, 120) }
    }
    return { status: res.status, data, location: res.headers.get('location') }
  }
}
const putFile = async (u, content, type = 'text/plain') =>
  (await fetch(u.url, { method: 'PUT', headers: { 'Content-Type': u.contentType || type }, body: content })).status

const rand = () => String(Math.floor(Math.random() * 1e9)).padStart(9, '0')
const stuA = { name: '测试甲', studentId: '1' + rand() }
const stuB = { name: '测试乙', studentId: '2' + rand() }

// ---- 未登录 ----
const anon = client()
check('anon-list-401', (await anon('/api/homework')).status === 401)
check('anon-me-null', (await anon('/api/auth/me')).data?.user === null)

// ---- 学号校验 ----
for (const [label, sid] of [['9-digits', '123456789'], ['11-digits', '12345678901'], ['letters', '12345abcde'], ['spaces', '12345 6789']]) {
  const r = await anon('/api/auth/login', { method: 'POST', body: { name: '某人', studentId: sid } })
  check(`login-reject-${label}`, r.status === 400, r.data?.error)
}
check('login-reject-empty-name', (await anon('/api/auth/login', { method: 'POST', body: { name: '  ', studentId: stuA.studentId } })).status === 400)

// ---- 学生登录 + 姓名绑定 ----
const a = client()
let r = await a('/api/auth/login', { method: 'POST', body: stuA })
check('student-login', r.status === 200 && r.data?.user?.isAdmin === false, JSON.stringify(r.data?.user))
check('student-me', (await a('/api/auth/me')).data?.user?.studentId === stuA.studentId)
r = await client()('/api/auth/login', { method: 'POST', body: { name: '冒名者', studentId: stuA.studentId } })
check('name-mismatch-409', r.status === 409, r.data?.error)
check('same-name-relogin', (await client()('/api/auth/login', { method: 'POST', body: stuA })).status === 200)
check('student-list-200', (await a('/api/homework')).status === 200)

// ---- 学生无权管理卡片 / 统计 ----
r = await a('/api/homework/prepare', { method: 'POST', body: { files: [] } })
check('student-publish-403', r.status === 403 && r.data?.error === '暂无权限', r.data?.error)
r = await a('/api/admin/stats')
check('student-stats-403', r.status === 403 && r.data?.error === '暂无权限', r.data?.error)

// ---- 管理员登录 ----
const admin = client()
r = await admin('/api/auth/login', { method: 'POST', body: { name: '管理员', studentId: ADMIN_ID } })
check('admin-needs-password', r.status === 200 && r.data?.needPassword === true)
r = await admin('/api/auth/login', { method: 'POST', body: { name: '管理员', studentId: ADMIN_ID, password: 'wrong-password' } })
check('admin-wrong-password-401', r.status === 401)
r = await admin('/api/auth/login', { method: 'POST', body: { name: '管理员', studentId: ADMIN_ID, password: ADMIN_PASSWORD } })
check('admin-login', r.status === 200 && r.data?.user?.isAdmin === true)

// ---- 全班同一出口 IP：60 个人连续登录都不能被限流 ----
const classIds = Array.from({ length: 60 }, (_, i) => `8${rand().slice(0, 7)}${String(i).padStart(2, '0')}`)
const classResults = await Promise.all(classIds.map((sid, i) => client()('/api/auth/login', { method: 'POST', body: { name: `同学${i}`, studentId: sid } })))
check('60-logins-same-ip-ok', classResults.every((x) => x.status === 200), classResults.map((x) => x.status).filter((x) => x !== 200).join(',') || 'all 200')

// ---- 管理员发布两张收作业卡片：一张未截止，一张已截止 ----
async function publish(subject, due) {
  const p = await admin('/api/homework/prepare', { method: 'POST', body: { files: [] } })
  const c = await admin('/api/homework/commit', { method: 'POST', body: { id: p.data.id, subject, items: ['测试'], due, collect: true, files: [] } })
  return c.data?.item
}
const open = await publish('【测试】收作业', '2099-12-31')
const closed = await publish('【测试】已截止', '2000-01-01')
check('admin-publish-collect', open?.collect === true && closed?.collect === true)

// 未开启收作业的卡片不能交
const p0 = await admin('/api/homework/prepare', { method: 'POST', body: { files: [] } })
const plain = (await admin('/api/homework/commit', { method: 'POST', body: { id: p0.data.id, subject: '【测试】普通', items: ['x'], files: [] } })).data?.item
r = await a(`/api/homework/${plain.id}/submit/prepare`, { method: 'POST', body: { files: [{ name: 'x.txt', size: 1, type: 'text/plain' }] } })
check('submit-non-collect-400', r.status === 400, r.data?.error)

// ---- 学生提交 ----
async function submit(who, card, content) {
  const prep = await who(`/api/homework/${card.id}/submit/prepare`, { method: 'POST', body: { files: [{ name: '我的作业.txt', size: Buffer.byteLength(content), type: 'text/plain' }] } })
  if (prep.status !== 200) return prep
  const up = prep.data.uploads[0]
  const st = await putFile(up, content)
  if (st !== 200) return { status: st }
  return who(`/api/homework/${card.id}/submit/commit`, {
    method: 'POST',
    body: { version: prep.data.version, files: [{ name: up.name, size: up.size, type: up.type, key: up.key }] },
  })
}
r = await submit(a, open, 'v1 content')
check('submit-v1', r.status === 200 && r.data?.submission?.late === false, r.data?.error)
const v1 = r.data?.submission
await new Promise((res) => setTimeout(res, 1100))
r = await submit(a, open, 'v2 content!')
check('resubmit-v2', r.status === 200 && r.data?.submission?.version !== v1?.version)
const v2 = r.data?.submission
r = await a(`/api/homework/${open.id}/my-submission`)
check('my-submission-is-latest', r.data?.submission?.version === v2?.version)

// 截止后提交 → 迟交
r = await submit(a, closed, 'late content')
check('late-flag', r.status === 200 && r.data?.submission?.late === true)

// 伪造他人路径提交 → 拒绝
const prepB = await (async () => {
  const b = client()
  await b('/api/auth/login', { method: 'POST', body: stuB })
  return { b, prep: await b(`/api/homework/${open.id}/submit/prepare`, { method: 'POST', body: { files: [{ name: 'b.txt', size: 1, type: 'text/plain' }] } }) }
})()
r = await prepB.b(`/api/homework/${open.id}/submit/commit`, {
  method: 'POST',
  body: { version: prepB.prep.data.version, files: [{ name: 'stolen', size: 1, type: 'text/plain', key: v1.files[0].key }] },
})
check('commit-foreign-key-400', r.status === 400, r.data?.error)
r = await prepB.b(`/api/homework/${open.id}/submit/commit`, {
  method: 'POST',
  body: { version: prepB.prep.data.version, files: [{ name: 'ghost', size: 1, type: 'text/plain', key: prepB.prep.data.uploads[0].key }] },
})
check('commit-missing-file-400', r.status === 400, r.data?.error)

// 学生不能下载别人（或自己）的提交文件，也不能用附件下载口绕过
check('student-file-link-403', (await a(`/api/admin/file?key=${encodeURIComponent(v1.files[0].key)}&name=x`)).status === 403)
check('download-route-blocks-submissions', (await a(`/api/download?key=${encodeURIComponent(v1.files[0].key)}&name=x`)).status === 400)

// ---- 管理员统计 ----
r = await admin('/api/admin/stats')
const s = r.data?.cards?.find((c) => c.id === open.id)
const mineRow = s?.submitted.find((x) => x.studentId === stuA.studentId)
check('stats-has-submission', r.status === 200 && !!mineRow && mineRow.versions === 2, JSON.stringify({ versions: mineRow?.versions }))
check('stats-missing-lists-B', !!s?.missing.find((x) => x.studentId === stuB.studentId))
check('stats-admin-not-in-roster', !s?.missing.find((x) => x.studentId === ADMIN_ID) && !s?.submitted.find((x) => x.studentId === ADMIN_ID))
check('stats-late-count', r.data?.cards?.find((c) => c.id === closed.id)?.lateCount === 1)
// 旧版本仍可下载（没被覆盖删除）
r = await admin(`/api/admin/file?key=${encodeURIComponent(v1.files[0].key)}&name=v1.txt`)
const body = r.location ? await (await fetch(r.location)).text() : ''
check('old-version-kept', r.status === 302 && body === 'v1 content', body)

// ---- 删除卡片不删提交 ----
await admin(`/api/homework/${open.id}`, { method: 'DELETE' })
r = await admin(`/api/admin/file?key=${encodeURIComponent(v2.files[0].key)}&name=v2.txt`)
check('submissions-survive-card-delete', r.status === 302 && (await (await fetch(r.location)).text()) === 'v2 content!')
await admin(`/api/homework/${closed.id}`, { method: 'DELETE' })
await admin(`/api/homework/${plain.id}`, { method: 'DELETE' })

// ---- 解除绑定 ----
check('student-unbind-403', (await a(`/api/admin/users/${stuB.studentId}`, { method: 'DELETE' })).status === 403)
check('admin-unbind', (await admin(`/api/admin/users/${stuB.studentId}`, { method: 'DELETE' })).status === 200)
check('rebind-new-name', (await client()('/api/auth/login', { method: 'POST', body: { name: '测试乙改', studentId: stuB.studentId } })).status === 200)

// ---- 退出 ----
await a('/api/auth/logout', { method: 'POST' })
check('logout', (await a('/api/homework')).status === 401)

// ---- 连续失败才会被限流（放在最后，避免影响上面的用例） ----
let last = 0
for (let i = 0; i < 21; i++) last = (await anon('/api/auth/login', { method: 'POST', body: { name: 'x', studentId: '1' } })).status
check('throttle-after-20-failures', last === 429, String(last))

console.log(JSON.stringify(results, null, 2))
console.log(`\n通过 ${pass} / 失败 ${failed}`)
process.exit(failed ? 1 : 0)
