// Minimal synchronous SHA-1 + HMAC-SHA1.
// Used instead of crypto.subtle so signing also works on plain-http LAN addresses
// (e.g. testing on a phone via http://192.168.x.x), where SubtleCrypto is unavailable.

function sha1(bytes: Uint8Array): Uint8Array {
  const ml = bytes.length
  const withPadding = ((ml + 8) >> 6) + 1
  const words = new Uint32Array(withPadding * 16)
  for (let i = 0; i < ml; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8)
  words[ml >> 2] |= 0x80 << (24 - (ml % 4) * 8)
  words[withPadding * 16 - 1] = ml * 8

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let blk = 0; blk < words.length; blk += 16) {
    for (let t = 0; t < 16; t++) w[t] = words[blk + t]
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]
      w[t] = (x << 1) | (x >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let t = 0; t < 80; t++) {
      let f: number
      let k: number
      if (t < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = temp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = new Uint8Array(20)
  ;[h0, h1, h2, h3, h4].forEach((h, i) => {
    out[i * 4] = h >>> 24
    out[i * 4 + 1] = (h >>> 16) & 0xff
    out[i * 4 + 2] = (h >>> 8) & 0xff
    out[i * 4 + 3] = h & 0xff
  })
  return out
}

export function hmacSha1Base64(key: string, message: string): string {
  const enc = new TextEncoder()
  let k: Uint8Array = enc.encode(key)
  if (k.length > 64) k = sha1(k)
  const block = new Uint8Array(64)
  block.set(k)
  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    ipad[i] = block[i] ^ 0x36
    opad[i] = block[i] ^ 0x5c
  }
  const msg = enc.encode(message)
  const inner = new Uint8Array(64 + msg.length)
  inner.set(ipad)
  inner.set(msg, 64)
  const innerHash = sha1(inner)
  const outer = new Uint8Array(64 + 20)
  outer.set(opad)
  outer.set(innerHash, 64)
  const digest = sha1(outer)
  let bin = ''
  digest.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}
