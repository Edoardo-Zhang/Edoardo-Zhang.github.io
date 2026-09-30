// 修改流程端到端测试：发布 -> 改内容 -> 加附件 -> 删旧附件 -> 校验 -> 删除
// 用真实 OSS 跑；跑完不留残留。
const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const out = {}
let pass = 0, bad = 0
const check = (n, ok, extra) => { out[n] = (ok ? 'PASS' : 'FAIL') + (extra ? ' ' + extra : ''); ok ? pass++ : bad++ }
const api = async (p, init) => {
  const res = await fetch(BASE + p, init)
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
  return { status: res.status, body }
}
const put = async (u, content, type) => (await fetch(u, { method: 'PUT', headers: { 'Content-Type': type }, body: content })).status

// 1) 发布：2 个附件
const prep = await api('/api/homework/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'a.txt', size: 3, type: 'text/plain' }, { name: 'b.txt', size: 3, type: 'text/plain' }] }) })
check('prepare', prep.status === 200 && prep.body.uploads.length === 2)
const id = prep.body.id
for (let i = 0; i < 2; i++) await put(prep.body.uploads[i].url, i === 0 ? 'aaa' : 'bbb', 'text/plain')
const created = await api('/api/homework/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, subject: '原始科目', items: ['原始内容'], files: prep.body.uploads.map((u) => ({ name: u.name, size: u.size, type: u.type, key: u.key })) }) })
check('commit', created.status === 200 && created.body.item.files.length === 2)
const createdAt = created.body.item.createdAt
const removedKey = prep.body.uploads[1].key

// 2) 修改：加一个新附件（沿用同一个 id 目录）
const prep2 = await api('/api/homework/' + id + '/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ name: 'c.txt', size: 3, type: 'text/plain' }] }) })
check('prepare-for-id', prep2.status === 200 && prep2.body.uploads[0].key.startsWith('zuoyexiang/files/' + id + '/'), 'key=' + (prep2.body.uploads[0]?.key ?? ''))
await put(prep2.body.uploads[0].url, 'ccc', 'text/plain')

// 3) 提交修改：保留 a.txt，移除 b.txt，加入 c.txt，改科目
const kept = created.body.item.files[0]
const newFile = { name: 'c.txt', size: 3, type: 'text/plain', key: prep2.body.uploads[0].key }
const updated = await api('/api/homework/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: '改过的科目', items: ['改过的内容'], author: 'dsh', files: [kept, newFile] }) })
check('update', updated.status === 200 && updated.body.item.subject === '改过的科目', 'files=' + (updated.body.item?.files?.length ?? '?'))
check('createdAt-preserved', updated.body.item.createdAt === createdAt)
check('updatedAt-set', typeof updated.body.item.updatedAt === 'number')

// 4) 列表里能读到新版本
const list = await api('/api/homework')
const inList = list.body.items.find((x) => x.id === id)
check('list-updated', inList?.subject === '改过的科目' && inList.files.length === 2, 'subject=' + inList?.subject)

// 5) 被移除的旧附件应当已从 OSS 删除（下载接口 302 后的签名链接应为 404）
const dl = await fetch(BASE + '/api/download?key=' + encodeURIComponent(removedKey) + '&name=b.txt', { redirect: 'manual' })
const gone = dl.headers.get('location') ? (await fetch(dl.headers.get('location'))).status : dl.status
check('removed-attachment-deleted', gone === 404, 'status=' + gone)

// 6) 保留的附件仍可下载
const dl2 = await fetch(BASE + '/api/download?key=' + encodeURIComponent(kept.key) + '&name=a.txt', { redirect: 'manual' })
const alive = dl2.headers.get('location') ? (await fetch(dl2.headers.get('location'))).status : dl2.status
check('kept-attachment-alive', alive === 200, 'status=' + alive)

// 7) 清理
check('delete', (await api('/api/homework/' + id, { method: 'DELETE' })).status === 200)
const after = await api('/api/homework')
check('no-leftover', !after.body.items.some((x) => x.id === id), 'items=' + after.body.items.length)

console.log(JSON.stringify(out, null, 2))
console.log('\n通过 ' + pass + ' / 失败 ' + bad)
process.exitCode = bad ? 1 : 0
