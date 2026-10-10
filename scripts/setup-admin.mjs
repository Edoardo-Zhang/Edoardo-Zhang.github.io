// 设置管理员：把你的学号、管理员口令（只存哈希）和会话密钥写进 server/.env。
// 用法（在项目根目录）：node scripts/setup-admin.mjs <你的10位学号>
// 口令在终端里输入，不会显示、不会出现在命令历史里。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../server/auth.mjs'

const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', '.env')
const studentId = String(process.argv[2] || '').trim()
if (!/^\d{10}$/.test(studentId)) {
  console.error('用法：node scripts/setup-admin.mjs <你的10位学号>')
  process.exit(1)
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

const pw1 = await askHidden('设置管理员口令（至少 8 位）：')
if (pw1.length < 8) {
  console.error('口令太短，至少 8 位。')
  process.exit(1)
}
const pw2 = await askHidden('再输入一次：')
if (pw1 !== pw2) {
  console.error('两次输入不一致。')
  process.exit(1)
}

const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split(/\r?\n/) : []
const set = (k, v) => {
  const i = lines.findIndex((l) => l.startsWith(`${k}=`))
  if (i >= 0) lines[i] = `${k}=${v}`
  else lines.push(`${k}=${v}`)
}
// 加入管理员名单（去重；已有的管理员保留）
const current = (lines.find((l) => l.startsWith('ADMIN_STUDENT_IDS=')) || '').slice('ADMIN_STUDENT_IDS='.length)
const ids = [...new Set([...current.split(/[,\s]+/).filter((s) => /^\d{10}$/.test(s)), studentId])]
set('ADMIN_STUDENT_IDS', ids.join(','))
set('ADMIN_PASSWORD_HASH', hashPassword(pw1))
// 已有会话密钥就保留（换掉会让所有人重新登录）
if (!lines.some((l) => /^SESSION_SECRET=.+/.test(l))) set('SESSION_SECRET', crypto.randomBytes(32).toString('hex'))
fs.writeFileSync(envFile, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 })
console.log(`已写入 ${envFile}：管理员名单 ${ids.join('、')}，口令已以哈希形式保存。重启后端后生效。`)
