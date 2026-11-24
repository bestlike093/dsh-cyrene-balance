#!/usr/bin/env node
/*
 * check-module-resets.mjs — t336 常驻判据（2026-11-23 裁定：先证红再落）
 *
 * 守的是设置页「清除本模块设置」这条链的三处接缝。三处任一断裂，用户看到的都是
 * 「按钮在、点了不对」，而界面不会报错，所以必须静态钉住：
 *   R0  集合非空（防零迭代假绿）
 *   R1  每条 entry.panel 必须解析到真面板（HTML 的 data-panel），否则 injectModuleResets 静默 continue → 缺按钮
 *   R2  entry.group 必须唯一：resetModule 用 MODULE_RESETS.find(item => item.group === dataset.resetModule)
 *       取条目，重复 group 会让后一条按钮清掉前一条的 keys → 清错模块
 *   R3  每条 entry.keys 必须全命中 DEFAULT_PATCH：miss 的键被 hasOwnProperty 静默丢弃 → 半哑
 *
 * 读法沿用 t336 教训：不用正则窗口扫 JS 结构（那样会漏裸键、会跨条目越界），
 * 而是按括号配平切字面量 + vm 真求值。自检用一条已上线功能的不变量：
 * RESET_ALL_KEYS 每个键都必须命中 DEFAULT_PATCH，否则「重置全部设置」是坏的。
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createContext, runInContext } from 'node:vm'

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const R = path.join(ROOT, 'pet', 'standalone', 'apps', 'desktop', 'electron', 'renderer')

const srcOf = (f) => fs.readFileSync(path.join(R, f), 'utf8').replace(/\r\n/g, '\n')
const settings = srcOf('settings.js')
const html = srcOf('settings.html')
const i18n = srcOf('i18n.js')
const petSchema = srcOf('pet-settings-schema.js')

/**
 * 归属权威源：渲染端 pet-settings-schema.js 的 field(path, label, type, panel, section)。
 * HTML 的 schema-zone 就是照它渲染的，105 条 panel 值与 data-panel 全对得上。
 * 建 path → panel，用来判「这个字段该由哪个面板的清除按钮管」。
 */
const petPanel = new Map()
for (const m of petSchema.matchAll(/field\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'/g)) {
  petPanel.set(m[1], m[4])
}

/** 把对象展开成叶子路径（a.b.c），数组按整体算叶子——它没有更深的路径语义。 */
function leafPaths(obj, prefix) {
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}.${k}`
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p))
    else out.push(p)
  }
  return out
}

/**
 * 从 `const NAME = ` 之后按括号配平切字面量（字符串与转义都不误计），带源码行号。
 * 关键：还要把紧随其后的 `NAME[...] = ...` 补丁赋值一起吃进来。
 * 只切字面量的话，任何后置补的键在静态读表时都是盲区——运行时存在、读表看不见，
 * 那正是 t336 里 presence.outline 造成假红的根因。读表必须读到运行时刻的真实那张表。
 */
function literalOf(name, src) {
  const m = new RegExp(`^const ${name}\\s*=\\s*`, 'm').exec(src)
  if (m === null) return null
  const line = src.slice(0, m.index).split('\n').length
  let i = m.index + m[0].length
  const open = src[i]
  const close = open === '{' ? '}' : open === '[' ? ']' : null
  if (close === null) return null
  let depth = 0
  let inStr = null
  for (let k = i; k < src.length; k += 1) {
    const c = src[k]
    if (inStr !== null) {
      if (c === '\\') { k += 1; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue }
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) {
        const litEnd = k + 1
        // 收集紧随其后的全部补丁赋值（允许中间夹空行与注释行），遇到别的语句就停。
        const tail = src.slice(litEnd).split('\n')
        let patchCode = ''
        for (const l of tail) {
          const t = l.trim()
          if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
          if (!new RegExp(`^${name}\\[`).test(t)) break
          patchCode += `\n${t.replace(/;$/, '')}`
        }
        const script = `const ${name} = ${src.slice(i, litEnd)};${patchCode}\n${name}`
        return { line, value: runInContext(script, createContext({}), { timeout: 2000 }) }
      }
    }
  }
  return null
}

/** 在给定源码文本上跑判据，返回行集合（供正跑与自检共用同一套逻辑）。 */
function audit(srcJs, srcHtml, i18Text = i18n) {
  const rows = []
  const push = (id, ok, detail) => rows.push({ id, ok: ok === true, detail: detail ?? '' })
  const dp = literalOf('DEFAULT_PATCH', srcJs)
  const mr = literalOf('MODULE_RESETS', srcJs)
  const rak = literalOf('RESET_ALL_KEYS', srcJs)
  if (dp === null || mr === null) {
    push('R0·两个字面量都能切片求值', false, `DEFAULT_PATCH=${dp === null ? '✗' : '✓'} MODULE_RESETS=${mr === null ? '✗' : '✓'}`)
    return rows
  }
  const dpKeys = new Set(Object.keys(dp.value))
  const panels = new Set([...srcHtml.matchAll(/data-panel="([^"]+)"/g)].map((m) => m[1]))
  // 与 settings.js 的 defaultFor 同口径：先认字面点路径键（'companion.axes' 是带引号的顶层键），
  // 认不到再逐层下钻（'presence.quiet.from'）。只查顶层键或只下钻，两种都会误判。
  const resolve = (key) => {
    if (Object.prototype.hasOwnProperty.call(dp.value, key)) return dp.value[key]
    return String(key).split('.').reduce((o, s) => (o === null || o === undefined ? undefined : o[s]), dp.value)
  }

  // 自检不变量：探针可信度试金石。RESET_ALL_KEYS 服务已上线的「重置全部设置」。
  if (rak !== null) {
    const bad = rak.value.filter((k) => resolve(k) === undefined)
    push('S0·RESET_ALL_KEYS 全能从 DEFAULT_PATCH 解析（探针可信前提）', bad.length === 0, bad.length === 0 ? `${rak.value.length}/${rak.value.length}` : `解析不到 ${bad.join(', ')}`)
  }
  push('R0·MODULE_RESETS 条目非空', mr.value.length > 0, `${mr.value.length} 条；真面板 ${panels.size} 个`)

  mr.value.forEach((x, i) => {
    push(`R1·第${i + 1}条(${x.group}/${x.panel}) panel 解析到真面板`, panels.has(x.panel), panels.has(x.panel) ? '' : `「${x.panel}」不在 data-panel 里 → injectModuleResets 会静默跳过，缺按钮`)
    const miss = (x.keys ?? []).filter((k) => resolve(k) === undefined)
    push(`R3·第${i + 1}条(${x.id}/${x.panel}) keys 全能解析到默认值`, miss.length === 0, miss.length === 0 ? `${(x.keys ?? []).length}/${(x.keys ?? []).length}` : `解析不到 ${miss.join(', ')} → 这些项点了不清（半哑）`)

    /*
     * R5：作用域不得越出本面板。R3 只问「命中与否」，问不出「命中了但整块太大」——
     * 一条 entry 挂整个 presence 块，点「清除主动台词」会连 persona 的城市、general 的描边、
     * account 的识屏授权一起抹掉。这类过度清除比清错更难让用户看懂，必须静态钉住。
     * 判法：key 若是块就展开叶子，逐叶查渲染端 schema 的 panel 归属；查到且 ≠ 本面板 → 红。
     * schema 没收录的键（companion.*、modules 等）不判红——没有权威归属就不臆断，只计入 soft。
     */
    const foreign = []
    let uncovered = 0
    for (const k of x.keys ?? []) {
      const v = dp.value[k]
      const paths = v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v)
        ? leafPaths(v, k)
        : [k]
      for (const p of paths) {
        const own = petPanel.get(p)
        if (own === undefined) { uncovered += 1; continue }
        if (own !== x.panel) foreign.push(`${p}(属 ${own})`)
      }
    }
    push(`R5·第${i + 1}条(${x.id}/${x.panel}) keys 作用域不越出本面板`, foreign.length === 0,
      foreign.length === 0
        ? `叶子全覆盖，其中 ${uncovered} 项渲染端 schema 未收录（不臆断归属）`
        : `越界 ${foreign.length} 项：${foreign.join(', ')} → 点这个按钮会清掉别的模块`)
  })
  const seenId = new Map()
  const seenPanel = new Map()
  mr.value.forEach((x, i) => {
    const prevId = seenId.get(x.id)
    if (prevId === undefined) seenId.set(x.id, i)
    else push(`R2·id「${x.id}」唯一`, false, `第${prevId + 1}条与第${i + 1}条同 id；resetModule 按 id find 取第一条 → 第${i + 1}条按钮会清第${prevId + 1}条的 keys（清错模块）`)
    const prevP = seenPanel.get(x.panel)
    if (prevP === undefined) seenPanel.set(x.panel, i)
    else push(`R2b·panel「${x.panel}」一面板一按钮`, false, `第${prevP + 1}条与第${i + 1}条都注进同一面板，两个「清除本模块设置」并排，用户分不出清的是哪块`)
  })
  if (seenId.size === mr.value.length) push('R2·全部 id 唯一', true, `${seenId.size} 个 id 无重复`)
  if (seenPanel.size === mr.value.length) push('R2b·全部 panel 各配一条', true, `${seenPanel.size} 个面板一一对应`)

  // R4：group 退回只服务文案查找，那就必须真取得到文案；缺失时界面会把原始 key 露给用户。
  mr.value.forEach((x, i) => {
    const key = `moduleClear.${x.group}Note`
    const n = (i18Text.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length
    push(`R4·第${i + 1}条(${x.group}/${x.panel}) 文案键 ${key} 双语齐`, n >= 2, n >= 2 ? `出现 ${n} 次` : `只出现 ${n} 次 → 缺的那一语会把原始 key 露在说明位`)
  })
  return rows
}

const SELFTEST = process.argv.includes('--self-test')
if (SELFTEST) {
  /*
   * 变异必须落在 MODULE_RESETS 块内。踩过一次：'presence.quiet.from' 在 settings.js 里出现两次，
   * 全文 replace 命中的是块外那一处——变异落地了、BAD-SAMPLE 守卫也过了，但条目根本没变，
   * 于是「该红的没红」被读成判据失灵。跟 MUT_LINE_NOT_FOUND 同族：以为改了，其实没改到点上。
   * inResets 把替换范围夹在配平出来的块内，改在哪变成可证的。
   */
  const inResets = (mut) => (s) => {
    const m = /^const MODULE_RESETS = \[/m.exec(s)
    if (m === null) return s
    const start = s.indexOf('[', m.index)
    let d = 0
    let inStr = null
    for (let k = start; k < s.length; k += 1) {
      const c = s[k]
      if (inStr !== null) { if (c === '\\') { k += 1; continue } if (c === inStr) inStr = null; continue }
      if (c === "'" || c === '"' || c === '`') { inStr = c; continue }
      if (c === '[') d += 1
      else if (c === ']') { d -= 1; if (d === 0) return s.slice(0, start) + mut(s.slice(start, k + 1)) + s.slice(k + 1) }
    }
    return s
  }
  // 七类坏样本各自必须红，且不许互相掩盖；正样本按下面的棘轮口径判。
  const cases = [
    ['幽灵 panel', inResets((b) => b.replace("panel: 'axes'", "panel: 'ghost-panel'")), ['R1'], 1],
    ['重复 id', inResets((b) => b.replace("id: 'memory'", "id: 'axes'")), ['R2'], 1],
    ['一面板两条', inResets((b) => b.replace("panel: 'talk'", "panel: 'voice'")), ['R2b'], 1],
    ['假 keys', inResets((b) => b.replace("'companion.axes'", "'totally.made.up'")), ['R3'], 1],
    ['group 取不到文案', inResets((b) => b.replace("group: 'look'", "group: 'nosuch'")), ['R4'], 1],
    // 点路径必须真解析得到，少一层就该红——这是 defaultFor 口径的核心。
    ['点路径解析不到', inResets((b) => b.replace("'presence.quiet.from'", "'presence.quiet.nope'")), ['R3'], 1],
    // 把当前 R5 干净的 memory 条目换成整块 presence，R5 必须新增一条红：
    // 拿本来就红的条目做样本证明不了什么，得让干净的变红才算抓住。
    // R5 收窄后正跑零红，干净条目被注入越界必须变红（红态立案期的 6 条期望作废）。
    ['整块越界', inResets((b) => b.replace("keys: ['companion.memory']", "keys: ['presence']")), ['R5'], 1],
  ]
  let code = 0
  for (const [name, mut, mustHit, minRed] of cases) {
    const mutated = mut(settings)
    if (mutated === settings) { console.log(`[check-module-resets] BAD-SAMPLE ${name}: 变异没落地`); code = 1; continue }
    const rows = audit(mutated, html)
    const reds = rows.filter((r) => r.ok === false)
    const hit = reds.some((r) => mustHit.some((p) => r.id.startsWith(p)))
    const okShape = reds.length >= minRed && hit
    console.log(`[check-module-resets] ${okShape ? 'CAUGHT' : 'MISSED'} ${name}: 红 ${reds.length} 条，命中目标=${hit}`)
    if (!okShape) code = 1
  }
  /*
   * 棘轮进入闭合态（2026-11-24 R5 收窄完成）：立案的五个条目 id 必须**仍在 MODULE_RESETS 表里**，
   * 且正跑 R5 与其余规则全零红。守的是两种回退——把越界条目整删了「躲红」（按钮消失、用户
   * 少一个清除入口，红却没了），以及日后有人往这五条里塞回越界键。数目或成员变了都要回来改账。
   */
  const FILED_R5 = ['look', 'voice', 'proactive', 'ability', 'system']
  // id 只在 MODULE_RESETS 块内取：全文 matchAll 会被块外同名 id 兜底，删条目躲棘轮就抓不住
  const resetsBlock = /^const MODULE_RESETS = \[[\s\S]*?^\]/m.exec(settings)
  const tableIds = resetsBlock === null ? [] : [...resetsBlock[0].matchAll(/\bid: '([a-z]+)'/g)].map((m) => m[1])
  const keptOk = FILED_R5.every((id) => tableIds.includes(id))
  const now = audit(settings, html).filter((r) => r.ok === false)
  const filedOk = keptOk && now.length === 0
  console.log(`[check-module-resets] ${filedOk ? 'CAUGHT' : 'MISSED'} 闭合棘轮：立案 id 在表 ${keptOk ? '5/5' : '缺 ' + FILED_R5.filter((id) => !tableIds.includes(id)).join('/')}、正跑红 ${now.length} 条（应 0）`)
  if (!filedOk) code = 1
  console.log('[END] script=check-module-resets.mjs code=' + code)
  process.exit(code)
}

const rows = audit(settings, html)
const bad = rows.filter((r) => r.ok === false)
rows.forEach((r) => {
  if (r.ok === false) console.error(`  RED ${r.id}  ${r.detail}`)
})
console.log(`[check-module-resets] 帧 ${rows.length}，红 ${bad.length}`)
if (bad.length > 0) {
  console.error('[check-module-resets] FAIL：清除本模块设置这条链有断点，见上')
  console.log('[END] script=check-module-resets.mjs code=1')
  process.exit(1)
}
console.log('[check-module-resets] OK：panel 全解析、group 全唯一、keys 全命中')
console.log('[END] script=check-module-resets.mjs code=0')
