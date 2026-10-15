// 无口令管理员模式：只配置 ADMIN_STUDENT_IDS（不设 ADMIN_PASSWORD_HASH）时，
// 白名单学号用「姓名 + 学号」即可登录为管理员，并能直接发布作业。
// 用法：BASE=http://127.0.0.1:3011 ADMIN_ID=1120260810 node test-admin-nopassword.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:3011'
const ADMIN_ID = process.env.ADMIN_ID || '1120260810'
const out = {}
let pass = 0, bad = 0
const check = (n, ok, extra = '') => { out[n] = (ok ? 'PASS' : 'FAIL') + (extra ? ' ' + extra : ''); ok ? pass++ : bad++ }
let cookie = ''
const req = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const text = await res.text()
  let data = null; try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 120) } }
  return { status: res.status, data }
}

// 1) 白名单学号：只填姓名 + 学号，不应返回 needPassword
const login = await req('/api/auth/login', { method: 'POST', body: { name: '张钱淇', studentId: ADMIN_ID } })
check('admin-login-without-password', login.status === 200 && login.data?.user?.isAdmin === true, JSON.stringify(login.data?.user ?? login.data))
check('no-need-password-flag', login.data?.needPassword !== true)

// 2) 管理员可以直接发布作业（prepare 走 requireAdmin）
const prep = await req('/api/homework/prepare', { method: 'POST', body: { files: [] } })
check('admin-can-prepare', prep.status === 200 && typeof prep.data?.id === 'string', 'id=' + (prep.data?.id ?? ''))

// 3) 非白名单学号仍然只能当普通学生（不能发布）
const stu = await req('/api/auth/login', { method: 'POST', body: { name: '测试学生', studentId: '2000000001' } })
check('student-login-ok', stu.status === 200 && stu.data?.user?.isAdmin === false)
const prepDenied = await req('/api/homework/prepare', { method: 'POST', body: { files: [] } })
check('student-cannot-prepare', prepDenied.status === 403, 'status=' + prepDenied.status)

console.log(JSON.stringify(out, null, 2))
console.log('\n通过 ' + pass + ' / 失败 ' + bad)
process.exitCode = bad ? 1 : 0
