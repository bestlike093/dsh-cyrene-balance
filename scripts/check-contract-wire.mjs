#!/usr/bin/env node
/**
 * check-contract-wire.mjs —— 契约接生产输出闸（P1-b 结构半 · 刀④ · 收口刀）
 *
 * 门挂到出口没有、形状对不对、放行等价不等价：
 *  W1 bond.mjs 的档位写回出口必须经 validateStageOutput（import + 调用点在位）；
 *  W2 拦截开关 STAGE_CONTRACT_ENFORCE 默认 false 且带翻真说明（诚实标注）；
 *  W3 生产形状恒合规：跑 bond 正常流转（定档/升档/退档 fixture），出口组装的
 *     契约对象（stageKey/source/confidence/traceId 四件）必须全 ok——违例只该
 *     出现在 3.x 模型版或坏代码，正常生产永不再违例，若 W3 红了说明接线自己造了脏形状；
 *  W4 违例样本有牙：直接喂 validateStageOutput 三款违例（越档表/source 双值/confidence 越界）必拦；
 *  W5 放行等价形状：ENFORCE=false 时 `verdict.ok || ENFORCE!==true` 恒真——
 *     静态断言拦截分支在默认开关下不可达（行为逐字节等价的代码级证据）。
 *
 * 用法：node scripts/check-contract-wire.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const put = (name, ok, got) => results.push({ name, ok, got: String(got ?? '') })

const bondSrc = fs.readFileSync(path.join(ROOT, 'lib/companion/state/bond.mjs'), 'utf8')
const { validateStageOutput } = await import(pathToFileURL(path.join(ROOT, 'lib/companion/state/stage-contract.mjs')).href)
const { defaultBond, normalizeBond, applyBondEvent, setAffinityLocked } =
  await import(pathToFileURL(path.join(ROOT, 'lib/companion/state/bond.mjs')).href)

// W1 出口挂门
{
  const hasImport = /from '\.\/stage-contract\.mjs'/.test(bondSrc)
  const hasCall = /validateStageOutput\(\{[\s\S]{0,200}stageKey:\s*stage\.key/.test(bondSrc)
  put('W1 档位写回出口经 validateStageOutput', hasImport && hasCall, `import=${hasImport} call=${hasCall}`)
}

// W2 开关默认关 + 说明
{
  const off = /const STAGE_CONTRACT_ENFORCE = false/.test(bondSrc)
  const honest = /翻真/.test(bondSrc)
  put('W2 ENFORCE 默认 false 且带翻真说明', off && honest, `off=${off} honest=${honest}`)
}

// W3 生产形状恒合规（正常流转全档出口都该过门）
{
  const DAY = 86400000
  const t0 = Date.UTC(2026, 8, 1, 4, 0, 0)
  let b = normalizeBond(defaultBond(t0, 'owner', 'wire-seed'), t0)
  const seq = []
  for (const [type, d, amt] of [['shareSecret', 70, 3], ['promise', 72, 3], ['anniversary', 74, 3], ['betray', 90, 3], ['comeBack', 95, 2]]) {
    b = applyBondEvent(b, { type, amount: amt }, { now: t0 + d * DAY }).bond
    if (b.stageKey) seq.push(b.stageKey)
    const v = validateStageOutput({ stageKey: b.stageKey ?? '', source: 'auto', confidence: 1, traceId: `bond:${b.stageKey}:${t0 + d * DAY}` })
    if (!v.ok) { put('W3 生产流转出口全合规', false, `第 ${seq.length} 档违例: ${v.violations.join('|')}`); break }
    if (type === 'comeBack') put('W3 生产流转出口全合规（定档/升档/退档五连）', true, seq.join('→'))
  }
}

// W4 违例样本有牙
{
  const a = validateStageOutput({ stageKey: 'not_a_stage', source: 'auto', confidence: 1, traceId: 't' })
  const b2 = validateStageOutput({ stageKey: 'familiar', source: 'both', confidence: 1, traceId: 't' })
  const c = validateStageOutput({ stageKey: 'familiar', source: 'auto', confidence: 2, traceId: '' })
  put('W4 三款违例必拦（越档表/source 双值/confidence 越界+缺痕）', !a.ok && !b2.ok && !c.ok,
    `${a.violations.length}/${b2.violations.length}/${c.violations.length} 条违例全咬`)
}

// W5 拦截分支默认不可达
{
  const branch = /if \(verdict\.ok \|\| STAGE_CONTRACT_ENFORCE !== true\) next\.stageKey = stage\.key/.test(bondSrc)
  put('W5 默认开关下拦截分支不可达（放行=逐字节等价）', branch, branch ? '形状在：ENFORCE=false → 恒写回，与接门前一致' : '形状变了，人来核')
}

// W6 粘住门与契约门共存不打架（regression 形状：locked 优先于 contract——锁住时根本不出门）
{
  const order = /if \(next\.affinityLocked !== true\) \{[\s\S]{0,400}validateStageOutput/.test(bondSrc)
  put('W6 粘住门在外、契约门在内（锁住时不出门不校验）', order, order ? '锁短路先判，契约只校活跃写回' : '嵌套顺序变了')
}

let fail = 0
for (const r of results) {
  if (!r.ok) fail += 1
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  → ${r.got.slice(0, 150)}`)
}
console.log(`[check-contract-wire] 共 ${results.length} 条，红 ${fail} 条`)
console.log('[END] script=check-contract-wire code=' + (fail ? 1 : 0))
process.exit(fail ? 1 : 0)
