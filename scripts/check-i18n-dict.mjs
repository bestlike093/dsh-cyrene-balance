/*
 * check-i18n-dict.mjs —— 语言字典双全闸
 *
 * 裁定（2026-11-24 主人）：断言「每个字典键 zh/en 双全」，先证当下必红再补。
 * 取证发现红有两层（2026-11-24 探针实测）：
 *   层一 键集漂移：ZH 1367 / EN 1645；EN 独有 280（schema.* 族为主），ZH 独有 2（voiceWake.allowCloud*）
 *   层二 引用悬空：lib/settings-schema 的 90 处 i18n:'settings.*' 在字典里 0 命中，
 *         且 lib/client.js 根本不消费 field.i18n——这批引用在 DSH 面是死元数据；
 *         消费 field.i18n 的是 pet 侧（schema-renderer.js / settings.js），它们用 schema.* 族键，
 *         那族在 EN 有 ZH 无 → 英文键配中文界面的回落链正建立在层一的漂移上。
 * 修复面（补词条 / 删死引用 / 接消费链）归主人裁，本闸只负责把洞钉死显示。
 *
 * 判据：
 *   D1 ZH/EN 键集一致：双向缺项各列名单（超 0 即红）
 *   D2 引用双全：两侧 schema 出现过的 i18n 值（lib + pet 的 i18n: 'x'），每个都须在 ZH∧EN 存在
 *   D3 死引用面告警（不计红只报数）：lib schema 的引用在 DSH 面无任何消费点——
 *      client.js 无 field.i18n 时把数量摆出来，修复方向由人定，闸不擅自判删。
 *
 * 用法：node scripts/check-i18n-dict.mjs
 *   code=0 绿 / 1 红 / 2 环境不满足
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const I18N = join(ROOT, 'pet/standalone/apps/desktop/electron/renderer/i18n.js')
const LIB_SCHEMA = join(ROOT, 'lib/settings-schema.mjs')
const PET_SCHEMA = join(ROOT, 'pet/standalone/apps/desktop/electron/renderer/pet-settings-schema.js')
const CLIENT = join(ROOT, 'lib/client.js')

function blockKeys(src, name) {
  const start = src.indexOf(`const ${name} = {`)
  if (start < 0) return null
  let depth = 0
  let i = src.indexOf('{', start)
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  const keys = new Set()
  for (const m of src.slice(start, i).matchAll(/^\s{4}'([A-Za-z][\w.]*)':/gm)) keys.add(m[1])
  return keys
}

let i18nSrc = ''
let libSrc = ''
let petSrc = ''
let clientSrc = ''
try {
  i18nSrc = readFileSync(I18N, 'utf8').replace(/\r/g, '')
  libSrc = readFileSync(LIB_SCHEMA, 'utf8').replace(/\r/g, '')
  petSrc = (() => { try { return readFileSync(PET_SCHEMA, 'utf8').replace(/\r/g, '') } catch { return '' } })()
  clientSrc = readFileSync(CLIENT, 'utf8').replace(/\r/g, '')
} catch (error) {
  console.log(`  SKIP 源读不到：${error?.message ?? error}`)
  console.log('[END] script=check-i18n-dict.mjs code=2')
  process.exit(2)
}
const ZH = blockKeys(i18nSrc, 'ZH')
const EN = blockKeys(i18nSrc, 'EN')
if (ZH === null || EN === null || ZH.size === 0 || EN.size === 0) {
  console.log('  SKIP ZH/EN 块解析失败（形状变了，先修探针再修闸）')
  console.log('[END] script=check-i18n-dict.mjs code=2')
  process.exit(2)
}

const rows = []
const missEn = [...ZH].filter((k) => !EN.has(k))
const missZh = [...EN].filter((k) => !ZH.has(k))
rows.push({ ok: missEn.length === 0, name: `D1a·ZH 有而 EN 缺（≤0）`, detail: `${missEn.length}${missEn.length ? '：' + missEn.slice(0, 6).join(', ') + (missEn.length > 6 ? ' …' : '') : ''}` })
rows.push({ ok: missZh.length === 0, name: `D1b·EN 有而 ZH 缺（≤0）`, detail: `${missZh.length}${missZh.length ? '：' + missZh.slice(0, 6).join(', ') + (missZh.length > 6 ? ' …' : '') : ''}` })

const refs = new Set([
  ...[...libSrc.matchAll(/i18n:\s*'([^']+)'/g)].map((m) => m[1]),
  ...[...petSrc.matchAll(/i18n:\s*'([^']+)'/g)].map((m) => m[1]),
])
const danglingZh = [...refs].filter((k) => !ZH.has(k))
const danglingEn = [...refs].filter((k) => !EN.has(k))
rows.push({ ok: danglingZh.length === 0, name: 'D2a·schema 引用在 ZH 全命中', detail: `${refs.size} 引用缺 ${danglingZh.length}${danglingZh.length ? '：' + danglingZh.slice(0, 6).join(', ') + ' …' : ''}` })
rows.push({ ok: danglingEn.length === 0, name: 'D2b·schema 引用在 EN 全命中', detail: `${refs.size} 引用缺 ${danglingEn.length}${danglingEn.length ? '：' + danglingEn.slice(0, 6).join(', ') + ' …' : ''}` })

const libRefs = [...new Set([...libSrc.matchAll(/i18n:\s*'([^']+)'/g)].map((m) => m[1]))]
const clientConsumes = /field\.i18n|\.i18n\b/.test(clientSrc)
console.log(`D3 告警（不判红）：lib schema 引用 ${libRefs.length} 处；client.js 消费 field.i18n = ${clientConsumes}；其中字典无命中 ${libRefs.filter((k) => !ZH.has(k) && !EN.has(k)).length} 处＝DSH 面死元数据候选`)

let bad = 0
for (const r of rows) {
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  ${r.detail}`)
  if (!r.ok) bad++
}
console.log(`[check-i18n-dict] 红 ${bad} 条`)
console.log(`[END] script=check-i18n-dict.mjs code=${bad > 0 ? 1 : 0}`)
process.exit(bad > 0 ? 1 : 0)
