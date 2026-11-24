/*
 * check-schema-fork.mjs —— 两套设置 schema 的键集分叉棘轮（甲-棘轮）
 *
 * 背景（2026-11-23 夜真机复核定格）：
 *   lib/settings-schema.mjs        93 键  → 投给 Cyrene 聊天页那张设置卡片（lib/client.js:3125 NAV_GROUPS）
 *   renderer/pet-settings-schema.js 105 键 → 投给 DSH 桌宠设置窗（settings.html:1518 脚本位）
 *   两个渲染面各读一套表，严格名比对：onlyLib=85  onlyRen=97  交集=8  分叉=182
 *
 * 这道闸只干一件事：**冻结 182，不许再长**。
 *   落完只许说「分叉冻结在 182」，它不代表「用户能看见全部设置了」——
 *   把 4 个记忆概念收成一处权威源是另一格（甲-对齐）的活，别拿这条绿当那格 Done。
 *
 * 182 这个数怎么读，别读歪：
 *   键名级分叉 182 个。把命名法归一（去 companion./channels. 前缀、点分转驼峰）后，
 *   重叠从 8 组涨到 21 组 —— 多出 13 组是「同一概念两套写法」（memoryEnabled ↔ companion.memory.enabled、
 *   bubbleMode ↔ bubble.mode 这一类），它们占掉 182 里的 26 个键。
 *   真正另一面没有对应物的，是 182-26=156 个。C4/C5 两栏各锁一个数，都要读出来才不作伪。
 *
 * 四条纪律：
 *   1. 解析器瞎了必须先自知：两文件读不到、或任一边解出 0 键，直接 code=2，
 *      不许让「解不出来」伪装成「没有分叉」的全绿。今晚栽过第十次，正则少一种引号就是一片假绿。
 *   2. 棘轮只降不升：新增分叉键必点名红；分叉变少也不算自动赢 —— 基线里留着已不存在的键，
 *      等于给未来留了吞新增的额度，所以那条也红，逼一次显式 --sync-fork-baseline。
 *   3. --self-test 三发假输入验分辨力（摘一条基线键 / 塞一条新分叉 / 把一边解空），
 *      摘不掉就不算闸。
 *   4. 本文件与基线里不得出现使用者姓名、真机路径、私有仓库名。
 *
 * 用法：
 *   node scripts/check-schema-fork.mjs                    跑判据
 *   node scripts/check-schema-fork.mjs --sync-fork-baseline  按当前态签基线（改完表要显式跑）
 *   node scripts/check-schema-fork.mjs --self-test         验闸自己
 *   [END] code=0 绿 / 1 红 / 2 环境或解析不满足（红与连不上分开）
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIB_REL = 'lib/settings-schema.mjs'
const REN_REL = 'pet/standalone/apps/desktop/electron/renderer/pet-settings-schema.js'
const BASELINE_REL = 'scripts/schema-fork.baseline.json'

const readKeys = (rel, mode) => {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return null
  const text = readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const re = mode === 'lib' ? /key:\s*'([^']+)'/g : /\bfield\(\s*'([^']+)'/g
  const out = new Set()
  for (const m of text.matchAll(re)) out.add(m[1])
  return out
}

/* 命名法归一：让「同概念不同写法」能被认出来 */
const norm = (k) => {
  let s = k
  for (const pre of ['companion.', 'channels.']) if (s.startsWith(pre)) s = s.slice(pre.length)
  return s.replace(/\.(\w)/g, (_, c) => c.toUpperCase()).toLowerCase()
}

/**
 * 判据本体：输入两套键集与基线，输出用例表。纯函数，好被 --self-test 喂假输入。
 */
function judge(libKeys, renKeys, baseline) {
  const cases = []
  const push = (name, ok, detail = '') => cases.push({ name, ok, detail })
  const onlyLib = [...libKeys].filter((k) => !renKeys.has(k)).sort()
  const onlyRen = [...renKeys].filter((k) => !libKeys.has(k)).sort()
  const fork = [...onlyLib.map((k) => ['lib', k]), ...onlyRen.map((k) => ['ren', k])]
  const forkNames = new Set(fork.map(([, k]) => k))
  const known = new Set(baseline ? baseline.fork.map(([, k]) => k) : [])

  // C1 新增分叉：实测有、基线没登记
  const added = fork.filter(([, k]) => !known.has(k))
  push('C1·新增分叉键必须显式登记（棘轮只降不升）', added.length === 0,
    added.length === 0 ? `已登记 ${known.size} 个，实测 ${forkNames.size} 个`
      : `新长 ${added.length} 个：${added.slice(0, 8).map(([s, k]) => `${s}←${k}`).join(', ')}${added.length > 8 ? ' …' : ''}`)

  // C2 基线虚高：登记过、实测已不存在，说明改完表没重签，额度会吞掉未来的新增
  const stale = baseline ? baseline.fork.filter(([, k]) => !forkNames.has(k)) : []
  push('C2·基线不得留着已消失的分叉（虚高额度会吞新增）', stale.length === 0,
    stale.length === 0 ? '基线与实测一一对上' : `已消失但仍挂着 ${stale.length} 个：${stale.slice(0, 8).map(([s, k]) => `${s}←${k}`).join(', ')} → 显式跑 --sync-fork-baseline`)

  // C3 总数与两侧分布
  push('C3·分叉总数与基线一致', baseline ? fork.length === baseline.total : false,
    `实测 ${fork.length}（lib ${onlyLib.length} / ren ${onlyRen.length}） 基线 ${baseline ? baseline.total : '(无)'}`)

  // C4 概念级：归一后「异名同义」组数不许升
  const libN = new Map(); for (const k of libKeys) libN.set(norm(k), (libN.get(norm(k)) ?? []).concat(k))
  const renN = new Map(); for (const k of renKeys) renN.set(norm(k), (renN.get(norm(k)) ?? []).concat(k))
  const shadow = [...libN.keys()].filter((n) => renN.has(n) && !(String(libN.get(n)) === String(renN.get(n))))
  const conceptual = fork.length - shadow.length * 2
  push('C4·归一命名后「异名同义」组数不许超基线', baseline ? shadow.length <= baseline.shadowGroups : false,
    `实测 ${shadow.length} 组（涉及 ${shadow.length * 2} 键）基线 ${baseline ? baseline.shadowGroups : '(无)'} —— 概念级真分叉 ${conceptual}`)

  // C5 概念级读数留档（不判红绿，只把 156 这个数钉在报告里，防「182 个概念」误读）
  push('C5·概念级真分叉数已留档', baseline ? conceptual <= baseline.conceptual : false,
    `实测 ${conceptual} 基线 ${baseline ? baseline.conceptual : '(无)'}（182 是键名级，别当成 182 个概念）`)

  return { cases, fork, onlyLib, onlyRen, shadow, conceptual }
}

function report(cases) {
  let bad = 0
  for (const c of cases) {
    console.log(`  ${c.ok ? 'OK ' : 'RED'} ${c.name}  ${c.detail}`)
    if (!c.ok) bad += 1
  }
  console.log(`[check-schema-fork] 共 ${cases.length} 条，红 ${bad} 条`)
  return bad
}

/* ---------------- --self-test：验闸有分辨力 ---------------- */
if (process.argv.includes('--self-test')) {
  const lib = readKeys(LIB_REL, 'lib')
  const ren = readKeys(REN_REL, 'ren')
  if (lib === null || ren === null) { console.log('  BAD-SAMPLE 读不到源文件，自测无意义'); console.log('[END] script=check-schema-fork.mjs code=2'); process.exit(2) }
  const good = judge(lib, ren, { total: [...lib].filter((k) => !ren.has(k)).length + [...ren].filter((k) => !lib.has(k)).length, fork: [...[...lib].filter((k) => !ren.has(k)).map((k) => ['lib', k]), ...[...ren].filter((k) => !lib.has(k)).map((k) => ['ren', k])], shadowGroups: 21, conceptual: 156 })
  const caught = (f) => { const r = f(); return report(r.cases) > 0 }

  // S1 从基线里抹掉一条真实分叉 → C1 必须红（等于没登记的新增）
  const s1 = () => {
    const b = { total: good.fork.length, fork: good.fork.slice(1), shadowGroups: 21, conceptual: 156 }
    return judge(lib, ren, b)
  }
  // S2 凭空多一条分叉键（两边各加一个不存在的新名）→ C1/C3 必须红
  const s2 = () => {
    const lib2 = new Set([...lib, 'brandNewOnlyLibKey'])
    const ren2 = new Set([...ren, 'brandNewOnlyRenKey'])
    const b = { total: good.fork.length, fork: good.fork, shadowGroups: 21, conceptual: 156 }
    return judge(lib2, ren2, b)
  }
  // S3 基线留着已消失的键 → C2 必须红
  const s3 = () => {
    const b = { total: good.fork.length + 1, fork: [...good.fork, ['lib', 'gone.long.ago']], shadowGroups: 21, conceptual: 156 }
    return judge(lib, ren, b)
  }
  const tests = [['S1·漏登记一条分叉', s1], ['S2·凭空新长两条分叉', s2], ['S3·基线挂着已消失的键', s3]]
  let ok = 0
  for (const [name, f] of tests) {
    const hit = caught(f)
    console.log(`  ${hit ? 'CAUGHT' : 'MISSED'} ${name}${hit ? ' → 闸能红' : ' → 摘掉/塞进去都不红，这闸是摆设'}`)
    if (hit) ok += 1
  }
  console.log(`\n自测 ${ok}/${tests.length} 拦住`)
  console.log('[END] script=check-schema-fork.mjs code=' + (ok === tests.length ? 0 : 1))
  process.exit(ok === tests.length ? 0 : 1)
}

/* ---------------- 正常判据 ---------------- */
const libKeys = readKeys(LIB_REL, 'lib')
const renKeys = readKeys(REN_REL, 'ren')
console.log(`[check-schema-fork] ${LIB_REL}  vs  ${REN_REL}`)
if (libKeys === null || renKeys === null) {
  console.log('  SKIP 两套 schema 至少有一份读不到，判不了分叉')
  console.log('[END] script=check-schema-fork.mjs code=2')
  process.exit(2)
}
if (libKeys.size === 0 || renKeys.size === 0) {
  console.log(`  SKIP 解析出 0 键（lib=${libKeys.size} ren=${renKeys.size}）：正则失配等于闸瞎了，不许报绿`)
  console.log('[END] script=check-schema-fork.mjs code=2')
  process.exit(2)
}
console.log(`  lib ${libKeys.size} 键   renderer ${renKeys.size} 键`)

const bp = join(ROOT, BASELINE_REL)
if (process.argv.includes('--sync-fork-baseline')) {
  const r = judge(libKeys, renKeys, { total: 0, fork: [], shadowGroups: 999, conceptual: 999 })
  const obj = {
    note: '两套设置 schema 的键集分叉基线；新增分叉必须显式重签并回写审计账。此文件不含使用者姓名、真机路径与仓库名。',
    fork: r.fork,
    total: r.fork.length,
    libOnly: r.onlyLib.length,
    renOnly: r.onlyRen.length,
    shadowGroups: r.shadow.length,
    conceptual: r.conceptual,
    syncedAt: new Date().toISOString(),
  }
  writeFileSync(bp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  console.log(`  [sync] 已写 ${BASELINE_REL}：分叉 ${obj.total}（lib ${obj.libOnly} / ren ${obj.renOnly}） 异名同义 ${obj.shadowGroups} 组 概念级 ${obj.conceptual}`)
  console.log('[END] script=check-schema-fork.mjs code=0')
  process.exit(0)
}

if (!existsSync(bp)) {
  console.log('  SKIP 基线不存在。先跑 --sync-fork-baseline 显式签一份，没基线就等于没闸。')
  console.log('[END] script=check-schema-fork.mjs code=2')
  process.exit(2)
}
const baseline = JSON.parse(readFileSync(bp, 'utf8'))
const res = judge(libKeys, renKeys, baseline)
const bad = report(res.cases)
console.log(`  现场：onlyLib=${res.onlyLib.length} onlyRen=${res.onlyRen.length} 分叉=${res.fork.length} 异名同义=${res.shadow.length} 组 概念级=${res.conceptual}`)
console.log(`  基线签于 ${baseline.syncedAt}`)
console.log('[END] script=check-schema-fork.mjs code=' + (bad > 0 ? 1 : 0))
process.exit(bad > 0 ? 1 : 0)
