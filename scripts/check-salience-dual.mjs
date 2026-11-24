#!/usr/bin/env node
/**
 * check-salience-dual.mjs —— 单一显著性双处作用闸（P1-b 结构半 · 刀③ · 断言④载体）
 *
 * 断言④「注意力预算收紧时，写入侧抽取量随之下降，不是恒定全抽」：
 *  N1 卫兵等价：enabled!==true → factor 恒 1（未启用路径逐字节走老逻辑）；
 *  N2 钳位：budgetRatio>1/<2 钳回 [0,1]，NaN 归 0；
 *  N3 单调链：ratio 1.0/0.6/0.3 三连 → writeCap 非增，且 floor=1 不掐通道；
 *  N4 接线：index.js 的 ingestCap 必须经 writeCapFor，且带 enabled 开关与预算源；
 *  N5 占位诚实：attentionBudgetRatio 桩必须带 TODO 标记——标记丢=「恒 1 没人知道」的假绿；
 *  N6 单源：写侧与（后续）读侧同出 salienceOf，扫描 salience.mjs 无第二处 factor 推导。
 *
 * 用法：node scripts/check-salience-dual.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const put = (name, ok, got) => results.push({ name, ok, got: String(got ?? '') })

const { salienceOf, writeCapFor } = await import(pathToFileURL(path.join(ROOT, 'lib/companion/state/salience.mjs')).href)

// N1 卫兵等价
{
  const off = salienceOf({ budgetRatio: 0.3, enabled: false })
  const undef = salienceOf({ budgetRatio: 0.3 })
  put('N1 卫兵：未启用一律 factor=1（老路径零差）', off.factor === 1 && off.enabled === false && undef.factor === 1,
    `off=${off.factor} default=${undef.factor}`)
}

// N2 钳位
{
  const hi = salienceOf({ budgetRatio: 7, enabled: true }).factor
  const lo = salienceOf({ budgetRatio: -3, enabled: true }).factor
  const nan = salienceOf({ budgetRatio: 'x', enabled: true }).factor
  put('N2 钳位：>1→1、<0→0、非数→0', hi === 1 && lo === 0 && nan === 0, `hi=${hi} lo=${lo} nan=${nan}`)
}

// N3 单调链 + floor
{
  const a = writeCapFor({ limit: 6, budgetRatio: 1.0, enabled: true })
  const b = writeCapFor({ limit: 6, budgetRatio: 0.6, enabled: true })
  const c = writeCapFor({ limit: 6, budgetRatio: 0.3, enabled: true })
  const z = writeCapFor({ limit: 6, budgetRatio: 0, enabled: true })
  put('N3 预算收紧→写侧名额非增（断言④行为案）', a === 6 && b === 4 && c === 2 && z === 1 && a >= b && b >= c && c >= z,
    `ratio 1.0/0.6/0.3/0 → cap ${a}/${b}/${c}/${z}（floor=1 通道不断）`)
}

// N4 接线
{
  const idx = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
  const wired = /writeCapFor\(/.test(idx) && /salienceOf|writeCapFor/.test(idx) && /attentionBudgetRatio\(\)/.test(idx)
  const guarded = /SALIENCE_ENABLED|salienceEnabled/.test(idx)
  put('N4 接线：ingestCap 经 writeCapFor + 开关 + 预算源', wired && guarded,
    `writeCapFor=${/writeCapFor\(/.test(idx)} 开关字样=${guarded} 源函数=${/attentionBudgetRatio\(\)/.test(idx)}`)
}

// N5 占位诚实
{
  const idx = fs.readFileSync(path.join(ROOT, 'lib/index.js'), 'utf8')
  const at = idx.search(/function attentionBudgetRatio\s*\(\s*\)/)
  const window = at >= 0 ? idx.slice(at, at + 260) : ''
  const honest = window.includes('TODO')
  put('N5 预算源桩带 TODO 标记（恒 1 必须可被人看见）', at >= 0 && honest, at < 0 ? '未找到函数' : (honest ? '桩在且标了' : '桩在但没标——假绿温床'))
}

// N6 单源
{
  const src = fs.readFileSync(path.join(ROOT, 'lib/companion/state/salience.mjs'), 'utf8')
  const factorDefs = (src.match(/factor\s*[:=]/g) || []).length
  put('N6 factor 只在 salienceOf 一处推导', factorDefs <= 3, `出现 ${factorDefs} 处（返回对象拼装允许，二次公式禁止）`)
}

let fail = 0
for (const r of results) {
  if (!r.ok) fail += 1
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  → ${r.got.slice(0, 150)}`)
}
console.log(`[check-salience-dual] 共 ${results.length} 条，红 ${fail} 条`)
console.log('[END] script=check-salience-dual code=' + (fail ? 1 : 0))
process.exit(fail ? 1 : 0)
