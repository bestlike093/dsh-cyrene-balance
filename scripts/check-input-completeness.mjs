/**
 * 进料齐备尺（审计专用 · 非交付件，未进主树 registry）
 *
 * 你裁的护栏四件里，第 3、4 件需要一支能独立判「输入齐不齐」的尺：
 *   ③ 闸面绿必须挂在输入齐备上 —— 任一进料缺件直接红，不许拼表出 verdict。
 *   ④ frozen 的 bypassed 名单里有文件名 ≠ 有权威输入副本 —— 本尺把「名单」与「实物」分开记。
 * 另记 ①（崩溃红 vs 判据红）与 ②（产方静默重生成）的现状定位，供迁主树时逐处改。
 *
 * 用法：node scripts/check-input-completeness.mjs [--self-test] [--live <根>] [--json]
 * 退出码：0 = 进料齐备且权威副本在位；1 = 有缺件（infeed=missing，判据红，非崩溃红）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const li = process.argv.indexOf('--live')
const LIVE = li > 0 && process.argv[li + 1] ? path.resolve(process.argv[li + 1]) : HERE
const FIXTURE_MODE = li < 0
/* IS_MAIN 守卫：被 import 时不得跑主流程。第三次踩这格（union-pending 之后是 version-registry，
   这次是 rewrite-trace）—— import 触发 process.exit 会把调用方脚本一起带走，输出看着像跑完了其实全空。 */
import { fileURLToPath as __furl } from 'node:url'
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __furl(import.meta.url)
const shaF = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

/* 进料清单：判据脚本实际读取的件（现扫行号见 basis-prefill-two-tiers.json） */
const INFEED = [
  { path: 'docs/audits/ship-evidence/pending-refreeze.json', 被读: ['scripts/union-chains.mjs:161', 'scripts/dist-hash-freeze.mjs:277'], 权威副本: 'docs/audits/ship-evidence/chains/infeed-pending-refreeze.json' },
  { path: 'docs/audits/ship-evidence/adjudication-prefill.json', 被读: ['scripts/prefill-adjudication.mjs:327'], 权威副本: 'docs/audits/ship-evidence/chains/infeed-adjudication-prefill.json' },
  { path: 'docs/audits/ship-evidence/infeed-registry.json', 被读: ['scripts/infeed-registry.mjs 自检'], 权威副本: null },
  { path: 'docs/audits/ship-evidence/chains/union-chains.frozen.json', 被读: ['scripts/union-chains.mjs 冻结比对'], 权威副本: null },
  { path: 'scripts/ledger-structure.baseline.json', 被读: ['scripts/check-ledger-structure.mjs', 'check-baseline-stale 判据'], 权威副本: null },
]

export function judgeInfeed({ root }) {
  const missing = []
  const rows = INFEED.map((f) => {
    const p = path.join(root, f.path)
    const exists = fs.existsSync(p)
    if (!exists) missing.push(f.path)
    const auth = f.权威副本 ? path.join(root, f.权威副本) : null
    const authExists = auth ? fs.existsSync(auth) : null
    return {
      path: f.path, exists, bytes: exists ? fs.statSync(p).size : null, sha256: exists ? shaF(p) : null,
      被读: f.被读, 权威副本: f.权威副本 ?? '(无需)', 权威副本在位: authExists,
      权威副本sha: authExists ? shaF(auth) : null,
      权威副本与活件同sha: authExists ? shaF(auth) === shaF(p) : null,
    }
  })
  /* 名单 vs 实物分开记：frozen.bypassed 里出现文件名，不构成权威副本 */
  const frozenPath = path.join(root, 'docs/audits/ship-evidence/chains/union-chains.frozen.json')
  let 名单提及 = []
  if (fs.existsSync(frozenPath)) {
    const fz = JSON.parse(fs.readFileSync(frozenPath, 'utf8'))
    const bl = JSON.stringify(fz.bypassed ?? fz)
    名单提及 = INFEED.filter((f) => bl.includes(path.basename(f.path))).map((f) => path.basename(f.path))
  }
  const noAuth = rows.filter((r) => r.权威副本 !== '(无需)' && r.权威副本在位 !== true).map((r) => r.path)
  return {
    inputCompleteness: missing.length === 0,
    missing, 行: rows, 名单提及但无实物副本: 名单提及.filter((n) => noAuth.some((p) => p.endsWith(n))),
    待补权威副本: noAuth,
  }
}

/** ①②现状定位（不改主树，只把待修点钉成行号，供迁第 20 支前置） */
export function locateGuardDefects({ root }) {
  const read = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8').split(/\r?\n/) } catch { return [] } }
  const out = []
  const uc = read('scripts/union-chains.mjs')
  const l161 = uc.findIndex((l) => l.includes('pending-refreeze.json') && /JSON\.parse\(fs\.readFileSync/.test(l))
  out.push({ 项: '①崩溃红当判据红', 位置: l161 >= 0 ? `scripts/union-chains.mjs:${l161 + 1}` : '(未定位)', 现状: l161 >= 0 ? uc[l161].trim().slice(0, 110) : '', 应改成: '显式 exit=1 infeed=missing + 可核文案，配阳性' })
  const up = read('scripts/union-pending.mjs')
  const w = up.findIndex((l) => /writeFileSync\(/.test(l) && /OUT/.test(l))
  const guard = up.some((l) => /existsSync/.test(l))
  out.push({ 项: '②产方静默重生成', 位置: w >= 0 ? `scripts/union-pending.mjs:${w + 1}` : '(未定位写盘点)', 现状: `写盘点存在=${w >= 0} · 缺件先判=${guard}`, 应改成: '缺件必报不得重生成（freeze 基线禁止自动重建那一族）' })
  const pa = read('scripts/prefill-adjudication.mjs')
  const w2 = pa.findIndex((l) => /writeFileSync\(/.test(l) && /out\b/.test(l))
  out.push({ 项: '②产方静默重生成（prefill 侧）', 位置: w2 >= 0 ? `scripts/prefill-adjudication.mjs:${w2 + 1}` : '(未定位)', 现状: '探针实测缺件 --self-test exit=0 无 FAIL 行', 应改成: '同上，并让 --self-test 带进料断言' })
  const cc = read('scripts/check-conventions.mjs')
  out.push({ 项: '③闸面无 inputCompleteness', 位置: 'scripts/check-conventions.mjs', 现状: `现字面出现 ${cc.filter((l) => l.includes('inputCompleteness')).length} 次`, 应改成: 'GATE 输出加布尔，任一进料缺件直接红，不许拼表出 verdict' })
  return out
}

export function selfTest() {
  const cases = []
  const push = (name, ok, got) => cases.push({ name, ok: !!ok, got: String(got) })
  const root = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMP || '/tmp', 'cic-'))
  const put = (p, s) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s, 'utf8') }
  put('docs/audits/ship-evidence/infeed-registry.json', '{"ruleVersion":"2026-11-18.1","rows":[]}')
  put('scripts/ledger-structure.baseline.json', '{"sections":1,"at":"x"}')
  put('docs/audits/ship-evidence/chains/union-chains.frozen.json', '{"bypassed":["pending-refreeze.json","adjudication-prefill.json"]}')
  let r = judgeInfeed({ root })
  push('阳性·两件进料缺失时 inputCompleteness=false 且列全 missing', r.inputCompleteness === false && r.missing.length === 2, `missing=${r.missing.length} ${r.missing.join(',')}`)
  push('阳性·名单提及但无实物副本 → 单独报（名单≠副本）', r.名单提及但无实物副本.length === 2, r.名单提及但无实物副本.join(','))
  put('docs/audits/ship-evidence/pending-refreeze.json', '{"rows":[]}')
  put('docs/audits/ship-evidence/adjudication-prefill.json', '{"n":1}')
  r = judgeInfeed({ root })
  push('阳性·进料齐了但权威副本仍缺 → 仍列待补', r.inputCompleteness === true && r.待补权威副本.length === 2, `待补=${r.待补权威副本.length}`)
  put('docs/audits/ship-evidence/chains/infeed-pending-refreeze.json', '{"rows":[]}')
  put('docs/audits/ship-evidence/chains/infeed-adjudication-prefill.json', '{"n":1}')
  r = judgeInfeed({ root })
  push('阴性·副本补齐且与活件同 sha → 全绿', r.待补权威副本.length === 0 && r.inputCompleteness === true && r.行.every((x) => x.权威副本与活件同sha !== false), JSON.stringify(r.行.map((x) => x.权威副本与活件同sha)))
  fs.rmSync(root, { recursive: true, force: true })
  return cases
}

if (IS_MAIN) {
const asJson = process.argv.includes('--json')
if (process.argv.includes('--self-test')) {
  const cs = selfTest()
  let pass = 0
  for (const c of cs) { if (c.ok) { pass += 1; continue } console.log(`FAIL ${c.name} → ${c.got}`) }
  console.log(`self-test ${pass}/${cs.length} 通过`)
  console.log('[check-input-completeness][END]')
  process.exit(pass === cs.length ? 0 : 1)
}

const res = judgeInfeed({ root: LIVE })
const defects = locateGuardDefects({ root: LIVE })
if (asJson) { console.log(JSON.stringify({ inputCompleteness: res.inputCompleteness, 行: res.行, 待补权威副本: res.待补权威副本, 护栏缺陷定位: defects }, null, 2)) }
else {
  console.log(`[check-input-completeness] 读取树：${LIVE}${FIXTURE_MODE ? '（fixture 模式：未传 --live，输出不作判据，exit 恒 0）' : ''}`)
  console.log(`[check-input-completeness] inputCompleteness=${res.inputCompleteness} | 进料 ${res.行.length} 件 | missing=${res.missing.length ? res.missing.join(', ') : '（无）'}`)
  for (const x of res.行) console.log(`  ${x.exists ? '在位' : '缺件'} ${x.path} ${x.bytes ?? 0} B | sha ${(x.sha256 ?? '').slice(0, 16) || '—'} | 权威副本=${x.权威副本}${x.权威副本在位 === null ? '' : x.权威副本在位 ? ' 在位·同sha=' + x.权威副本与活件同sha : ' [缺]'}`)
  if (res.名单提及但无实物副本.length) console.log(`  名单提及但无实物副本（bypassed 名单 ≠ 副本）：${res.名单提及但无实物副本.join(', ')}`)
  console.log('[check-input-completeness] 护栏缺陷定位（主树本帧零改动，迁第 20 支前置）：')
  for (const d of defects) console.log(`  ${d.项} → ${d.位置} | ${d.现状} | 应改成：${d.应改成}`)
}
console.log('[check-input-completeness][END]')
process.exit(FIXTURE_MODE ? 0 : (res.inputCompleteness && res.待补权威副本.length === 0 ? 0 : 1))
}
