/**
 * 版本号登记核对尺（审计专用 · 非交付件，未进主树 registry）· 第二版
 *
 * 你钉的表行口径：表按「号」登记、不按「处」。
 *   表载行数 = 唯一值数；每行必须列该值全部 file:line，缺一处红。
 *   与 infeed-registry 自检 L231「表内 X 行 / 现算 Y 件」同源，那格待升硬断言。
 * 另三条：排除面写死依据（tmp 旧帧不得反复报无名号）；占位值永不写入表载字段，写入即红；
 *   去重只按 file:line:value 去同一条重复，同一值出现在两个不同文件仍算 2 处。
 *
 * 用法：node scripts/check-version-registry.mjs [--self-test] [--live <根>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const li = process.argv.indexOf('--live')
const LIVE = li > 0 && process.argv[li + 1] ? path.resolve(process.argv[li + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_MODE = li < 0
/* IS_MAIN 守卫：被 import 时不得跑主流程。第三次踩这格（union-pending 之后是 version-registry，
   这次是 rewrite-trace）—— import 触发 process.exit 会把调用方脚本一起带走，输出看着像跑完了其实全空。 */
import { fileURLToPath as __furl } from 'node:url'
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __furl(import.meta.url)

const VEXT = /['"`](\d{4}-\d{2}-\d{2}\.\d+)['"`]/g
/* 父子不得同列：readdirSync(recursive) 已含全部后代，scripts 与 scripts/lib、
   ship-evidence 与 ship-evidence/chains 同时出现会把同一处以两种 key 各记一次（本轮实测过）。 */
const SCAN_DIRS = ['scripts', 'lib', 'docs/audits/ship-evidence', '.']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'backup', 'worktrees', '.git'])
/* tmp/ 排除依据（你裁）：旧帧垃圾，权威在 ship-evidence/chains/；不删留证，但不进扫描面、不进 HEAD 不进包 */
const SKIP_TOP = new Set(['tmp'])
/* 自指排除：作用域表本身就载着全部号，扫它会得到「表里每一行都是未登记号」的空转红。
   依据：该件是登记表（判据输入），不是被登记物；它的完整性由 judge 的号↔处对等来管。 */
const SKIP_FILES = new Set(['docs/audits/ship-evidence/version-scope-map.json'])

export function collect(root) {
  const seen = new Set()
  const out = []
  for (const d of SCAN_DIRS) {
    const dir = path.join(root, d)
    if (!fs.existsSync(dir)) continue
    const recursive = d !== '.'
    let ents
    try { ents = fs.readdirSync(dir, recursive ? { recursive: true } : {}) } catch { continue }
    for (const f of ents) {
      const rel = String(f).replace(/\\/g, '/')
      if (SKIP_TOP.has(rel.split('/')[0]) || SKIP_DIRS.has(rel.split('/')[0])) continue
      const p = path.join(dir, String(f))
      let st
      try { st = fs.statSync(p) } catch { continue }
      if (!st.isFile() || !/\.(mjs|js|cjs|json)$/.test(p)) continue
      /* 自测字面量不参与现算：尺子自己造的假号（未登记 .n、2027-01-01.9 等）不是现役版本号 */
      /* 路径口径必须唯一：readdirSync(recursive) 与 path.relative 在同一棵树上会给出发
         'scripts\\lib\\x.mjs' 与 'lib\\x.mjs' 两种形式，归一后若仍分叉，表就会把同一处记成两条、
         尺子再报「表行缺这一处」——这是本轮实测出的真根因。统一以 dir + 相对项 为唯一来源。 */
      const key = (d === '.' ? rel : `${d}/${rel}`).replace(/\\/g, '/')
      const txt = fs.readFileSync(p, 'utf8')
      if (key === 'scripts/check-version-registry.mjs' && txt.includes('export function selfTest')) continue
      if (SKIP_FILES.has(key)) continue
      for (const m of txt.matchAll(VEXT)) {
        const line = txt.slice(0, m.index).split(/\r?\n/).length
        const k = `${key}:${line}:${m[1]}`
        if (seen.has(k)) continue       // 只去掉同一条重复
        seen.add(k)                      // 同值不同文件 → 不同 key → 仍算两处
        out.push({ file: key, line, value: m[1], loc: `${key}:${line}` })
      }
    }
  }
  return out
}

/** 硬闸一：生成器写出的 ruleVersion 必须 === RULE_VERSION_UNION（不等即红） */
export function judgeGeneratorConsistency({ tableText, unionConst }) {
  const got = (String(tableText).match(/"ruleVersion":\s*"([^"]+)"/) ?? [])[1] ?? null
  if (got === null) return { ok: false, 表值: null, 常量值: unionConst, why: "表里没有 ruleVersion 字段，生成器口径无法核对" }
  if (got !== unionConst) return { ok: false, 表值: got, 常量值: unionConst, why: "表 ruleVersion 与 RULE_VERSION_UNION 不等 → 有人手填或改错生成器引用" }
  return { ok: true, 表值: got, 常量值: unionConst, why: "同源" }
}

export function loadTable(root) {
  const p = path.join(root, 'docs', 'audits', 'ship-evidence', 'version-scope-map.json')
  if (!fs.existsSync(p)) return { err: '作用域表不存在', vals: [], 号登记: [], 排除面: [] }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  return { vals: (j.号登记 ?? []).map((r) => r.值), 号登记: j.号登记 ?? [], 排除面: j.排除面 ?? [], 废止号: j.废止号 ?? [] }
}

export function judge({ root, found, 号登记, 排除面, 废止号 = [] }) {
  const bad = []
  const declared = new Map()
  for (const r of 号登记) {
    if (r.现算 !== true && !String(r.手填来源说明 ?? '').trim()) bad.push(`手填号充当已登记：${r.值} —— 须带 现算:true，或写明 手填来源说明（谁/何时/为何手填）`)
    if (/(未取到|待补|TBD|placeholder)/.test(String(r.值))) { bad.push(`占位值写入表载字段：${r.值} —— 占位永不充当已登记，写入即红`); continue }
    declared.set(r.值, new Set((r.全部位置 ?? []).map((x) => x.file + ':' + x.line)))
  }
  const excluded = new Set(排除面.flatMap((e) => (e.全部位置 ?? []).map((x) => x.file + ':' + x.line)))
  const deprecated = new Set((废止号 ?? []).map((d) => d.值))
  const depLocs = new Set((废止号 ?? []).flatMap((d) => (d.全部位置 ?? []).map((x) => x.file + ':' + x.line)))
  for (const f of found) {
    if (!deprecated.has(f.value)) continue
    if (!depLocs.has(f.loc)) bad.push(`已废止号残字未登记位置：${f.loc} → ${f.value}（须进 废止号[].全部位置，且就地标 [已废止·从未生效]）`)
    const lineTxt = (() => { try { return fs.readFileSync(path.join(root, f.file), 'utf8').split(/\r?\n/)[f.line - 1] ?? '' } catch { return '' } })()
    if (!lineTxt.includes('[已废止·从未生效]')) bad.push(`残字未标废止：${f.loc} —— 标 [已废止·从未生效] 不删、不作依据`)
  }

  const uniqFound = new Set(found.map((f) => f.value))
  const valid = found.filter((f) => !excluded.has(f.loc))
  /* 废止号的处理改由上面「位置登记 + 残字标注」两格判，不再报「又出现在扫描面」 */
  for (const f of found) {
    if (excluded.has(f.loc)) continue
    if (!declared.has(f.value)) { if (!deprecated.has(f.value)) bad.push(`未登记 .n 号：${f.loc} → ${f.value}（须进 version-scope-map 号登记一行）`); continue }
    if (!declared.get(f.value).has(f.loc)) bad.push(`号 ${f.value} 的表行缺这一处：${f.loc}（表按号登记，缺一处红）`)
  }
  for (const [v, locs] of declared) {
    const hitLocs = new Set(valid.filter((f) => f.value === v && !excluded.has(f.loc)).map((f) => f.loc))
    if (hitLocs.size === 0 && !valid.some((f) => f.value === v)) { bad.push(`表载 ${v} 在扫描面已完全不再出现（表落后于实物）`); continue }
    for (const l of locs) if (!hitLocs.has(l) && !excluded.has(l)) bad.push(`表行声明了 ${v} 的 ${l}，扫描面没有 → 多声明或实物已消失（表与实物不符）`)
  }
  for (const e of 排除面) {
    for (const x of e.全部位置 ?? []) {
      if (!found.some((f) => `${f.file}:${f.line}` === `${x.file}:${x.line}`)) bad.push(`排除面声明了 ${e.值} 的 ${x.file}:${x.line}，实物已不在（排除依据要跟着改或删行）`)
    }
  }
  return {
    ok: bad.length === 0, bad,
    统计: {
      扫描处: found.length, 有效处: valid.length, 排除处: found.length - valid.length,
      唯一值含排除: uniqFound.size, 有效唯一值: new Set(valid.map((f) => f.value)).size,
      表载号数: declared.size,
      表行口径: `表载行数 ${declared.size} 应等于有效唯一值数 ${new Set(valid.map((f) => f.value)).size}`,
    },
  }
}

export function selfTest() {
  const cases = []
  const push = (name, ok, got) => cases.push({ name, ok: !!ok, got: String(got) })
  const T = (v, locs) => ({ 值: v, 现算: true, 全部位置: locs.map((l) => ({ file: l.split(':')[0], line: Number(l.split(':')[1]) })) })
  const F = (loc, v) => ({ file: loc.split(':')[0], line: Number(loc.split(':')[1]), value: v, loc })
  let r = judge({ found: [F('a.mjs:1', '2026-11-17.4'), F('b.json:3', '2026-11-17.4')], 号登记: [T('2026-11-17.4', ['a.mjs:1', 'b.json:3'])], 排除面: [] })
  push('阴性·按号登记且两处全列 → 放行', r.ok, JSON.stringify(r.bad))
  r = judge({ found: [F('a.mjs:1', '2026-11-17.4'), F('b.json:3', '2026-11-17.4'), F('c.mjs:9', '2026-11-17.4')], 号登记: [T('2026-11-17.4', ['a.mjs:1', 'b.json:3'])], 排除面: [] })
  push('阳性·表行漏一处必红（缺一处红）', r.bad.some((b) => /表行缺这一处/.test(b)), r.bad.find((b) => /表行缺这一处/.test(b)) ?? '(未报)')
  r = judge({ found: [F('a.mjs:1', '2026-11-17.4'), F('b.json:3', '2026-11-17.4')], 号登记: [T('2026-11-17.4', ['a.mjs:1', 'z.mjs:9'])], 排除面: [] })
  push('阳性·该号仍有别处在、表却多声明一处 → 报「表与实物不符」', r.bad.some((b) => /多声明|表与实物不符/.test(b)), r.bad.find((b) => /多声明|表与实物不符/.test(b)) ?? '(未报)')
  r = judge({ found: [F('a.mjs:1', '2026-11-17.4'), F('new.mjs:7', '2027-01-01.9')], 号登记: [T('2026-11-17.4', ['a.mjs:1'])], 排除面: [] })
  push('阳性·未登记 .n 号必红', r.bad.some((b) => /未登记/.test(b)), r.bad.find((b) => /未登记/.test(b)) ?? '(未报)')
  r = judge({ found: [F('a.mjs:1', '2026-11-17.4'), F('tmp/x.json:3', '2026-11-17.3')], 号登记: [T('2026-11-17.4', ['a.mjs:1'])], 排除面: [T('2026-11-17.3', ['tmp/x.json:3'])] })
  push('阴性·tmp 旧帧走排除面 → 不再反复报无名号', r.ok && r.统计.排除处 === 1, JSON.stringify({ bad: r.bad, 排除处: r.统计.排除处 }))
  r = judge({ found: [F('a.mjs:1', '2026-11-17.4')], 号登记: [T('(未取到)', ['x:1']), T('2026-11-17.4', ['a.mjs:1'])], 排除面: [] })
  push('阳性·占位值写入表载字段即红', r.bad.some((b) => /占位/.test(b)), r.bad.find((b) => /占位/.test(b)) ?? '(未报)')
  r = judge({ found: [F('a.mjs:1', '2026-11-17.4')], 号登记: [T('2026-11-99.9', ['z.mjs:1'])], 排除面: [] })
  push('阳性·表载号在实物完全消失必报', r.bad.some((b) => /落后于实物/.test(b)), r.bad.find((b) => /落后/.test(b)) ?? '(未报)')
  return cases
}

if (process.argv.includes('--self-test')) {
  const cs = selfTest()
  let pass = 0
  for (const c of cs) { if (c.ok) { pass += 1; continue } console.log(`FAIL ${c.name} → ${c.got}`) }
  console.log(`self-test ${pass}/${cs.length} 通过`)
  console.log(`[check-version-registry][END] fixture=1`)
  process.exit(pass === cs.length ? 0 : 1)
}

const bpTxt = (() => { try { return fs.readFileSync(path.join(LIVE, 'scripts/lib/bypass-prefixes.mjs'), 'utf8') } catch { return '' } })()
const unionConst = (bpTxt.match(/RULE_VERSION_UNION\s*=\s*['"]([^'"]+)['"]/) ?? [])[1] ?? null
const tablePath = path.join(LIVE, 'docs/audits/ship-evidence/infeed-registry.json')
const gen = judgeGeneratorConsistency({ tableText: fs.existsSync(tablePath) ? fs.readFileSync(tablePath, 'utf8') : '', unionConst })
const found = IS_MAIN ? collect(LIVE) : []
if (IS_MAIN) {
const { 号登记, 排除面, err } = loadTable(LIVE)
const r = judge({ root: LIVE, found, 号登记, 排除面, 废止号: loadTable(LIVE).废止号 })
console.log(`[check-version-registry] 读取树：${LIVE}${FIXTURE_MODE ? '（fixture 模式：未传 --live，不作判据，exit 恒 0）' : ''}`)
console.log(`[check-version-registry] ${JSON.stringify(r.统计)}${err ? ' | ' + err : ''}`)
if (!gen.ok) console.log(`  X 硬闸一·生成器一致性：${gen.why}（表=${gen.表值} / 常量=${gen.常量值}）`)
for (const b of r.bad) console.log('  X ' + b)
console.log(`[check-version-registry] ${r.ok ? 'OK：号与处一一对应，无无名号' : 'FAIL：' + r.bad.length + ' 项'}`)
console.log('[check-version-registry][END]' + (FIXTURE_MODE ? ' fixture=1' : ''))
process.exit(FIXTURE_MODE ? 0 : (r.ok && gen.ok ? 0 : 1))
}
