/*
 * check-theme-mapping.mjs —— 主题一义五账对齐闸（T1+T3 断言 · T2 出声检查）
 *
 * 裁定（2026-11-24 主人）：T2 回退加 warn 最优先止血；T1 两账对齐断言 + T3 归一登记同格，
 * 先立断言当复现——主人预测「当下必红（两本账不一致撑着）」，实测五份表值全等，
 * 真红在 M5：四处 ?? 回退全无声（toPet/toDsh/renderer THEME_PRESETS/settings.js THEME_SHORT）。
 * 「三处静默」是低估，本闸按现场计数钉为四处；五份表值等、消费点静默，正是 T2 的先落点。
 *
 * 五份表（同一语义，散落五处）：
 *   A schema petValues（lib/settings-schema.mjs theme 条目，短→长，登记权威）
 *   B SETTINGS_SYNC_THEME_TO_PET（main.mjs，短→长）
 *   C SETTINGS_SYNC_THEME_TO_DSH（main.mjs，长→短）
 *   D renderer THEME_PRESETS（长→短）
 *   E settings.js THEME_SHORT（长→短）
 *
 * 判据：
 *   M1 B == A            （短→长两份逐键等）
 *   M2 C == inverse(B)   （正反互逆）
 *   M3 D == C            （长→短两份逐键等）
 *   M4 E == D
 *   M5 回退出声：四处 `?? 兜底` 访问行的 ±3 行窗口内有 console.warn（T2 在场证明）
 *   M6 注释诚实：renderer「不认识的值一律回退 blue」旧注释（代码兜 pink）不得残留
 *   T3 说明：五份表当下全等，归并共享文件的重构不自造需求——M1..M4 绿即风险已被断言锁住，
 *      真分叉由断言点名；要不要物理合一等主人看完判活报告再定，本闸不越权。
 *
 * 用法：node scripts/check-theme-mapping.mjs [--self-test]
 *   code=0 绿 / 1 红 / 2 环境不满足
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getField } from '../lib/settings-schema.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = join(ROOT, 'pet/standalone/apps/desktop/electron/main.mjs')
const RENDERER = join(ROOT, 'pet/standalone/apps/desktop/electron/renderer/renderer.mjs')
const SETTINGS = join(ROOT, 'pet/standalone/apps/desktop/electron/renderer/settings.js')

function parseObj(src, name) {
  const m = new RegExp(`const ${name} = \\{([^}]*)\\}`).exec(src)
  if (m === null) return null
  const out = {}
  for (const p of m[1].split(',')) {
    const kv = /^\s*([A-Za-z_][\w]*)\s*:\s*'([^']+)'\s*$/.exec(p)
    if (kv !== null) out[kv[1]] = kv[2]
  }
  return out
}
const inverse = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]))
const eq = (a, b) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  const diff = [...keys].filter((k) => (a ?? {})[k] !== (b ?? {})[k])
  return diff.length === 0 ? null : diff.map((k) => `${k}: ${a?.[k] ?? '∅'} vs ${b?.[k] ?? '∅'}`)
}

function evaluate(schemaPet, mainSrc, rendererSrc, settingsSrc) {
  const rows = []
  const push = (name, ok, detail = '') => rows.push({ name, ok, detail })
  const B = parseObj(mainSrc, 'SETTINGS_SYNC_THEME_TO_PET')
  const C = parseObj(mainSrc, 'SETTINGS_SYNC_THEME_TO_DSH')
  const D = parseObj(rendererSrc, 'THEME_PRESETS')
  const E = parseObj(settingsSrc, 'THEME_SHORT')
  const A = Object.fromEntries(schemaPet.map(([s, l]) => [s, l]))
  if (B === null || C === null || D === null || E === null) {
    return [{ name: 'M0·五份表都解析得到', ok: false, detail: `B=${B !== null} C=${C !== null} D=${D !== null} E=${E !== null}` }]
  }
  push('M1·同步表 TO_PET 等于 schema petValues', eq(A, B) === null, eq(A, B)?.join(', ') ?? '')
  push('M2·TO_DSH 是 TO_PET 的逆', eq(C, inverse(B)) === null, eq(C, inverse(B))?.join(', ') ?? '')
  push('M3·renderer THEME_PRESETS 等于 TO_DSH', eq(D, C) === null, eq(D, C)?.join(', ') ?? '')
  push('M4·settings.js THEME_SHORT 等于 THEME_PRESETS', eq(E, D) === null, eq(E, D)?.join(', ') ?? '')

  const warnCheck = (src, anchor, label) => {
    const idxs = src.split('\n').map((l, i) => (l.includes(anchor) ? i : -1)).filter((i) => i >= 0)
    if (idxs.length === 0) return `${label}:锚点消失`
    for (const i of idxs) {
      const win = src.split('\n').slice(Math.max(0, i - 3), i + 4)
      if (!win.some((l) => l.includes('console.warn'))) return `${label}:第${i + 1}行回退无声`
    }
    return null
  }
  const silences = [
    warnCheck(mainSrc, 'SETTINGS_SYNC_THEME_TO_PET[v] ??', 'toPet'),
    warnCheck(mainSrc, 'SETTINGS_SYNC_THEME_TO_DSH[v] ??', 'toDsh'),
    warnCheck(rendererSrc, 'THEME_PRESETS[preset]', 'renderer 主题行'),
    warnCheck(settingsSrc, 'THEME_SHORT[preset]', 'applyTheme'),
  ].filter(Boolean)
  push('M5·四处回退都出声（T2 在场）', silences.length === 0, silences.join('；'))

  push('M6·renderer 旧注释「回退 blue」已改真', !rendererSrc.includes('不认识的值一律回退 blue'))
  return rows
}

if (process.argv.includes('--self-test')) {
  const theme = getField('theme')
  const pet = theme?.petValues
  if (Array.isArray(pet) === false) { console.log('  SKIP schema 无 theme.petValues'); process.exit(2) }
  const okMain = `const SETTINGS_SYNC_THEME_TO_PET = { pink: 'SakuraPink', blue: 'OceanBlue', ink: 'Paper' }\nconst SETTINGS_SYNC_THEME_TO_DSH = { SakuraPink: 'pink', OceanBlue: 'blue', Paper: 'ink' }\nconst x = (v) => SETTINGS_SYNC_THEME_TO_PET[v] ?? (console.warn('w'), 'SakuraPink'), y = (v) => SETTINGS_SYNC_THEME_TO_DSH[v] ?? (console.warn('w'), 'pink')`
  const okRen = `const THEME_PRESETS = { OceanBlue: 'blue', SakuraPink: 'pink', Paper: 'ink' }\nconst short = THEME_PRESETS[preset]\nif (short === undefined) console.warn('w')\ndocument.x = short ?? 'pink'`
  const okSet = `const THEME_SHORT = { OceanBlue: 'blue', SakuraPink: 'pink', Paper: 'ink' }\nconst short = THEME_SHORT[preset]\nif (short === undefined) console.warn('w')\nx = short ?? 'pink'`
  const cases = [
    { expectRed: false, label: '全对齐帧应绿', m: okMain, r: okRen, s: okSet },
    { expectRed: true, label: 'M1·TO_PET 与 schema 分叉应红', m: `const SETTINGS_SYNC_THEME_TO_PET = { pink: 'OceanBlue', blue: 'SakuraPink', ink: 'Paper' }\nconst SETTINGS_SYNC_THEME_TO_DSH = { SakuraPink: 'pink', OceanBlue: 'blue', Paper: 'ink' }\nconst x = SETTINGS_SYNC_THEME_TO_PET[v] ?? (console.warn('w'), 'SakuraPink')`, r: okRen, s: okSet },
    { expectRed: true, label: 'M4·两份长转短分叉应红', m: okMain, r: okRen, s: `const THEME_SHORT = { OceanBlue: 'blue', SakuraPink: 'violet', Paper: 'ink' }\nx = THEME_SHORT[p] ?? 'pink'` },
    { expectRed: true, label: 'M5·回退消音应红', m: okMain.replace(/console\.warn\('w'\), /g, ''), r: okRen, s: okSet },
  ]
  let bad = 0
  for (const c of cases) {
    const rows = evaluate(pet, c.m, c.r, c.s)
    const hasRed = rows.some((x) => !x.ok)
    const pass = hasRed === c.expectRed
    if (!pass) bad++
    console.log(`  ${pass ? (hasRed ? 'CAUGHT    ' : 'GREEN-OK  ') : (hasRed ? 'UNEXPECTED' : 'MISSED    ')} ${c.label}`)
  }
  console.log(`  坏例 ${bad}`)
  console.log(`[END] script=check-theme-mapping.mjs code=${bad > 0 ? 1 : 0}`)
  process.exit(bad > 0 ? 1 : 0)
}

const theme = getField('theme')
if (!Array.isArray(theme?.petValues)) {
  console.log('  SKIP schema theme 条目没带 petValues')
  console.log('[END] script=check-theme-mapping.mjs code=2')
  process.exit(2)
}
let mainSrc = '', renSrc = '', setSrc = ''
try {
  mainSrc = readFileSync(MAIN, 'utf8').replace(/\r/g, '')
  renSrc = readFileSync(RENDERER, 'utf8').replace(/\r/g, '')
  setSrc = readFileSync(SETTINGS, 'utf8').replace(/\r/g, '')
} catch (error) {
  console.log(`  SKIP 源读不到：${error?.message ?? error}`)
  console.log('[END] script=check-theme-mapping.mjs code=2')
  process.exit(2)
}
let bad = 0
for (const r of evaluate(theme.petValues, mainSrc, renSrc, setSrc)) {
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  ${r.detail}`)
  if (!r.ok) bad++
}
console.log(`[check-theme-mapping] 红 ${bad} 条`)
console.log(`[END] script=check-theme-mapping.mjs code=${bad > 0 ? 1 : 0}`)
process.exit(bad > 0 ? 1 : 0)
