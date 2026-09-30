// 阿里云 OSS 服务端助手：OSS V4 (OSS4-HMAC-SHA256) 预签名 URL + 基本读写。
// 与前端旧实现 (src/lib/oss.ts) 算法一致，但用 node:crypto，AccessKey 永远不出服务器。
import crypto from 'node:crypto'

const enc = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export function readOssConfig(env = process.env) {
  const rawRegion = (env.OSS_REGION || '').trim()
  const region = rawRegion.startsWith('oss-') ? rawRegion : rawRegion ? 'oss-' + rawRegion : ''
  const bucket = (env.OSS_BUCKET || '').trim()
  const accessKeyId = (env.OSS_ACCESS_KEY_ID || '').trim()
  const accessKeySecret = (env.OSS_ACCESS_KEY_SECRET || '').trim()
  let prefix = (env.OSS_PREFIX || 'zuoyexiang/').trim().replace(/^\/+/, '')
  if (prefix && !prefix.endsWith('/')) prefix += '/'
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('缺少 OSS 配置：需要 OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET')
  }
  return { region, bucket, accessKeyId, accessKeySecret, prefix, host: `https://${bucket}.${region}.aliyuncs.com` }
}

/** 生成预签名 URL；contentType 传入时必须与实际请求头一致。 */
export function presign(cfg, { method = 'GET', key = '', expiresIn = 900, contentType, subResources = {} } = {}) {
  const iso = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const day = iso.slice(0, 8)
  const region = cfg.region.replace(/^oss-/, '')
  const scope = `${day}/${region}/oss/aliyun_v4_request`
  const query = {
    ...subResources,
    'x-oss-credential': `${cfg.accessKeyId}/${scope}`,
    'x-oss-date': iso,
    'x-oss-expires': String(expiresIn),
    'x-oss-signature-version': 'OSS4-HMAC-SHA256',
  }
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => (query[k] === '' ? enc(k) : `${enc(k)}=${enc(query[k])}`))
    .join('&')
  const canonicalHeaders = contentType ? `content-type:${contentType.trim()}\n` : ''
  const canonicalRequest = [
    method,
    enc(`/${cfg.bucket}/${key}`).replace(/%2F/g, '/'),
    canonicalQuery,
    canonicalHeaders,
    '',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  const stringToSign = ['OSS4-HMAC-SHA256', iso, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest()
  let signingKey = hmac(`aliyun_v4${cfg.accessKeySecret}`, day)
  signingKey = hmac(signingKey, region)
  signingKey = hmac(signingKey, 'oss')
  signingKey = hmac(signingKey, 'aliyun_v4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `${cfg.host}/${path}?${canonicalQuery}&x-oss-signature=${signature}`
}
