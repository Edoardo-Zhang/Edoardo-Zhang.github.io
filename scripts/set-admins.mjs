// 设置管理员学号白名单（可多个，逗号分隔），并确保管理员不需要口令。
// 用法（项目根目录）：node scripts/set-admins.mjs 1120260810 [更多学号...]
// 效果：写入 server/.env 的 ADMIN_STUDENT_IDS，并把 ADMIN_PASSWORD_HASH 清空；
//       口令为空 = 白名单学号用「姓名 + 学号」直接登录为管理员。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', '.env')
const ids = process.argv.slice(2).map((s) => s.trim()).filter(Boolean)
if (!ids.length || ids.some((id) => !/^\d{10}$/.test(id))) {
  console.error('用法：node scripts/set-admins.mjs <10位学号> [更多学号...]')
  process.exit(1)
}
if (!fs.existsSync(envFile)) {
  console.error('找不到 ' + envFile + '（服务器上应已存在）')
  process.exit(1)
}
let txt = fs.readFileSync(envFile, 'utf8')
const upsert = (key, value) => {
  const re = new RegExp('^' + key + '=.*$', 'm')
  txt = re.test(txt) ? txt.replace(re, key + '=' + value) : txt.replace(/\s*$/, '') + '\n' + key + '=' + value + '\n'
}
upsert('ADMIN_STUDENT_IDS', ids.join(','))
upsert('ADMIN_PASSWORD_HASH', '')
if (!/^SESSION_SECRET=.+$/m.test(txt)) upsert('SESSION_SECRET', crypto.randomBytes(32).toString('hex'))
fs.writeFileSync(envFile, txt)
fs.chmodSync(envFile, 0o600)
const shown = (k) => {
  const m = new RegExp('^' + k + '=(.*)$', 'm').exec(txt)
  return k + '=' + (m && m[1] ? '<已设置，长度 ' + m[1].length + '>' : '<空>')
}
console.log('已更新 ' + envFile)
console.log('  ' + shown('ADMIN_STUDENT_IDS'))
console.log('  ' + shown('ADMIN_PASSWORD_HASH'))
console.log('  ' + shown('SESSION_SECRET'))
console.log('接下来：systemctl restart zuoyexiang')
