#!/usr/bin/env node
/**
 * staged 内容红线扫描。
 *
 * 为什么要有它：`scan-plugin-chain` 扫的是**工作区文件**，staged 前后内容一样，
 * 所以「扫描 0 命中」不能证明 staged 里干净。git add 之后内容进了 index，
 * 再改就是改历史前的最后一刻——这里单独对 `git diff --cached --diff-filter=A`
 * 的每个文件过一遍四类规则。
 *
 * 二进制（png 等）标「已知盲区，不拆包」，不算通过也不算失败。
 *
 * 用法：node scripts/check-staged-clean.mjs [--self-test]
 * 退出码：0 = 干净 / 自检通过；1 = 有命中 / 自检失败
 *
 * 两裁常例（主人裁定 2026-11-24 §8.55）：
 * ① 闸自指固定走转义化解（本文件 RULES/毒样本均转义构造），不开登记豁免；
 *    合法前提=self-test 的哨兵一每轮复验「阳性必报」——转义只许作用于闸的自指串，
 *    不许扩散到任何真数据面。登记只留给辖区外的账本面（non-release-surfaces.json）。
 * ② 从严默认必须可证明：--self-test 内置双哨兵——
 *    哨兵一·规则活性：每条规则必须咬得住真实语料（总账原文取真码点，不手敲），
 *    码点笔误/规则失效当场红，不等计数差；
 *    哨兵二·双面分流：同一条真名毒样，scripts/ 默认面必进红线桶、docs/audits/
 *    登记面必进计数桶，两桶都不许空、不许装反——「默认严」被喂毒证明，不是假设。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { KNOWN_FAKE as KNOWN_FAKE_SHARED } from './lib/known-fake.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TEXT_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml',
])

/** 二进制：不拆包，标盲区 */
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.onnx', '.bin', '.wasm', '.zip'])

/* 规则源用转义/拼接构造：闸自己的源码不是发布内容，但也不该被自己扫成红线——
   判定语义完全不变（self-test 的毒样本运行时仍是完整串），只是源码文本不出现连续字面。 */
const RULES = [
  { id: 'workdir', re: new RegExp('\u6614\u6d9f\u5de5\u4f5c\u533a', 'g') },
  { id: 'nickname', re: new RegExp('\u67d2\u67d2', 'g') },
  { id: 'mail', re: new RegExp('1786530' + '8831', 'g') },
  { id: 'userpath', re: /[A-Za-z]:[\\/]Users[\\/][^\\/\s'"]+/g },
  { id: 'drivepath', re: /[A-Za-z]:[\\/](?:\u6614\u6d9f|cyrene|project)[^\\/\s'"]*/gi },
  { id: 'cred', re: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
]

/* 白名单唯一源（§8.60）：闸与闸之间不许各带一张名单 */
const KNOWN_FAKE = KNOWN_FAKE_SHARED

const stagedAdded = () =>
  execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=A'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'))

/* 判据归位（§8.53）：staged-clean 只管发布候选面。非发布面走显式登记（带裁定出处），
   不是目录白名单——辖区外命中仍然计数上报，代码判定只看发布候选面。 */
const SURFACE_REGISTRY = 'scripts/non-release-surfaces.json'
let outsideSurfaces = []
try {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, SURFACE_REGISTRY), 'utf8'))
  outsideSurfaces = (Array.isArray(reg.surfaces) ? reg.surfaces : [])
    .filter((s) => s && typeof s.prefix === 'string' && typeof s.approvedBy === 'string' && s.approvedBy !== '')
} catch (error) {
  if (error?.code !== 'ENOENT') console.error(`[check-staged-clean] 登记表读坏（${error.message}）——按无登记处理，辖区外一律进红线`)
}
const isOutsideRelease = (rel) => outsideSurfaces.some((s) => rel.startsWith(s.prefix))

const scanFiles = (files) => {
  const hits = []
  const outside = []
  const skipped = []
  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase()
    if (BINARY_EXT.has(ext)) {
      skipped.push(rel)
      continue
    }
    if (!TEXT_EXT.has(ext)) continue
    const full = path.join(ROOT, rel)
    if (!fs.existsSync(full)) continue
    const bucket = isOutsideRelease(rel) ? outside : hits
    const text = fs.readFileSync(full, 'utf8')
    text.split(/\r?\n/).forEach((line, i) => {
      for (const rule of RULES) {
        rule.re.lastIndex = 0
        const m = rule.re.exec(line)
        if (!m) continue
        if (KNOWN_FAKE.has(m[0])) continue
        bucket.push({ rel, line: i + 1, rule: rule.id, hit: m[0].slice(0, 80) })
      }
    })
  }
  return { hits, outside, skipped }
}

/* ---------- 自检：阳性 + 阴性 ---------- */

if (process.argv.includes('--self-test')) {
  const probe = 'pet/__selftest-staged.txt'
  // 毒样本运行时拼接，源码不留连续字面（内容与旧版逐字节一致）
  fs.writeFileSync(path.join(ROOT, probe), '\u76ee\u5f55 D' + ':/Cyrene/x\n\u79f0\u547c \u67d2\u67d2\nkey sk-' + 'ABCDEFGHIJKLMNOPQRST', 'utf8')
  let result
  try {
    result = scanFiles([probe])
  } finally {
    fs.rmSync(path.join(ROOT, probe), { force: true })
  }

  const got = new Set(result.hits.map((h) => h.rule))
  const need = ['drivepath', 'nickname', 'cred']
  const missing = need.filter((r) => !got.has(r))

  console.log(`[check-staged-clean] 自检：阳性样本命中 ${[...got].join(', ') || '（无）'}`)
  if (missing.length) {
    console.error(`[check-staged-clean] 自检 FAIL：漏报 ${missing.join(', ')}`)
    console.log('[END] script=check-staged-clean.mjs code=1'), process.exit(1)
  }

  // 阴性：干净文本不应命中
  const clean = 'pet/__selftest-clean.txt'
  fs.writeFileSync(path.join(ROOT, clean), '这是一段没有任何红线的普通文本。', 'utf8')
  let cleanResult
  try {
    cleanResult = scanFiles([clean])
  } finally {
    fs.rmSync(path.join(ROOT, clean), { force: true })
  }
  if (cleanResult.hits.length !== 0) {
    console.error('[check-staged-clean] 自检 FAIL：干净文本误报')
    console.log('[END] script=check-staged-clean.mjs code=1'), process.exit(1)
  }

  /* 哨兵一·规则活性（裁②，逮码点笔误族）：每条规则必须咬得住真实语料。
     语料=脱敏前封存信封的解密回读（护栏三 §8.57 起；明文账本泛化后不再含真名，
     真码点的唯一持真面=sealed——授权本机回读，读不到按 FAIL 不静默绿）。 */
  let corpus = ''
  try {
    const { unsealText } = await import('../lib/companion/state/sealed-store.mjs')
    const ENV = 'docs/audits/sealed/ledger-v5-preHS3-b.sealed.json'
    const LOGICAL = 'audit-ledger-v5-pre-desensitization-20261124-b'
    corpus = unsealText(LOGICAL, fs.readFileSync(path.join(ROOT, ENV), 'utf8'))
  } catch { /* 缺信封/缺钥匙在下面按死规则处理 */ }
  // cred/mail 的活性语料账本本来就没有（153 处里无这两类）——构造行补位，
  // 号码与 key 都拆分构造：运行时拼完整，源码不留连续字面。
  const corpusFull = corpus + '\nkey sk-' + 'ABCDEFGHIJKLMNOPQRST' + '\n致电1786530' + '8831垂询'
  const deadRules = RULES.filter((r) => { r.re.lastIndex = 0; return !r.re.test(corpusFull) }).map((r) => r.id)
  if (corpus === '') {
    console.error('[check-staged-clean] 哨兵一 FAIL：真实语料（总账）读不到——规则活性无从证明，不静默绿')
    console.log('[END] script=check-staged-clean.mjs code=1'), process.exit(1)
  }
  if (deadRules.length > 0) {
    console.error(`[check-staged-clean] 哨兵一 FAIL·咬不住真实语料的规则：${deadRules.join(', ')}（码点笔误/正则失效/语料缺失）`)
    console.log('[END] script=check-staged-clean.mjs code=1'), process.exit(1)
  }
  console.log(`[check-staged-clean] 哨兵一 PASS：${RULES.length} 条规则全部咬得住真实语料`)

  /* 哨兵二·双面分流（裁②，证「默认严」+逮面死）：同一条从总账取的真名毒行，
     投到 scripts/ 默认面必进红线桶，投到 docs/audits/ 登记面必进计数桶。
     桶装反、哪面为零、分流逻辑崩——都到不了 PASS。用后即删，永不 add。 */
  const poisonLine = corpus.split(/\r?\n/).find((l) => /[A-Za-z]:[\\/]Users/.test(l)) || ''
  if (poisonLine === '') {
    console.error('[check-staged-clean] 哨兵二 FAIL：语料里取不到含用户路径的行，分流无从验证')
    console.log('[END] script=check-staged-clean.mjs code=1'), process.exit(1)
  }
  const P_DEF = 'scripts/__selftest-poison-default.md'
  const P_OUT = 'docs/audits/__selftest-poison-outside.md'
  let splitResult
  try {
    fs.writeFileSync(path.join(ROOT, P_DEF), poisonLine + '\n', 'utf8')
    fs.writeFileSync(path.join(ROOT, P_OUT), poisonLine + '\n', 'utf8')
    splitResult = scanFiles([P_DEF, P_OUT])
  } finally {
    fs.rmSync(path.join(ROOT, P_DEF), { force: true })
    fs.rmSync(path.join(ROOT, P_OUT), { force: true })
  }
  const defInHits = splitResult.hits.some((h) => h.rel === P_DEF)
  const outInOutside = splitResult.outside.some((h) => h.rel === P_OUT)
  const wrongBucket = splitResult.hits.some((h) => h.rel === P_OUT) || splitResult.outside.some((h) => h.rel === P_DEF)
  if (!defInHits || !outInOutside || wrongBucket) {
    console.error(`[check-staged-clean] 哨兵二 FAIL：默认面进红=${defInHits} 登记面进计数=${outInOutside} 装反=${wrongBucket}`)
    console.log('[END] script=check-staged-clean.mjs code=1'), process.exit(1)
  }
  console.log('[check-staged-clean] 哨兵二 PASS：默认面喂毒进红线桶、登记面喂毒进计数桶，分流活着')

  console.log('[check-staged-clean] 自检 PASS：阳性必报、阴性不误报、双哨在线')
  console.log('[END] script=check-staged-clean.mjs code=0'), process.exit(0)
}

/* ---------- 正式扫描 ---------- */

const files = stagedAdded()
const { hits, outside, skipped } = scanFiles(files)

console.log(`[check-staged-clean] staged 新增 ${files.length} 个文件`)
if (skipped.length) {
  console.log(`[check-staged-clean] 二进制盲区 ${skipped.length} 个（不拆包）：`)
  for (const s of skipped.slice(0, 20)) console.log(`  ${s}`)
}
if (outside.length > 0) {
  const byPrefix = new Map()
  for (const h of outside) {
    const parts = h.rel.split('/')
    const key = parts.slice(0, 2).join('/') + '/'
    byPrefix.set(key, (byPrefix.get(key) || 0) + 1)
  }
  console.log(`[check-staged-clean] 辖区外命中 ${outside.length} 处（登记表面，计数不静默；判据与出处见 ${SURFACE_REGISTRY}）：${[...byPrefix].map(([k, v]) => `${k}=${v}`).join(' ')}`)
}

if (hits.length > 0) {
  console.error(`[check-staged-clean] FAIL：发布候选面 ${hits.length} 处红线`)
  for (const h of hits.slice(0, 40)) console.error(`  ${h.rel}:${h.line}  ${h.rule} -> ${h.hit}`)
  console.log('[END] script=check-staged-clean.mjs code=1');
  process.exit(1)
}

console.log('[check-staged-clean] OK：发布候选面无红线（辖区外计数已在上方上报）')
