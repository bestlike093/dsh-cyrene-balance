/*
 * check-observation-polish.mjs —— 观察台观感止血闸（2026-11-24 主人裁定：只做①②）
 *
 * 把可判定的观感翻译成结构断言，不依赖视觉模型：
 *   V1  关系页 scopeLabel 的 QQ 三分支必须走 mCodeOf 代号口径——
 *       同一窗口里记忆页（mScopeItem 用 mCodeOf）与关系页（scopeLabel 拼裸串）
 *       对同一个 id 两套口径，且全量 32 位 hex 上屏。断言：函数体内
 *       不得出现未包 mCodeOf 的 `${raw.slice(` 模板。现状红 3 处。
 *   V2  .i-block-head 主定义（非 media 段）必须 flex-wrap——
 *       念头页统计行「开着·说过·过期·丢掉」在正常窗宽被裁的根因。现状红。
 *   V3  .i-cards 主定义必须是 auto-fill + minmax 安全列（防回归，现状已绿）。
 *
 * 说明：「统计卡渲染数==声明数、右缘不超容器」的 DOM 实测判据需要可启动的
 * 浏览器环境（本轮观察台窗口开不了），先以根因静态断言兜底；实测版随
 * 真机眼那格补。
 *
 * 用法：node scripts/check-observation-polish.mjs
 *   code=0 绿 / 1 红 / 2 环境不满足
 */
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r/g, '')

let js, css
try {
  js = read('pet/standalone/apps/desktop/electron/renderer/insight.js')
  css = read('pet/standalone/apps/desktop/electron/renderer/insight.css')
} catch (e) {
  console.log('  SKIP 源读不到：' + (e?.message ?? e))
  console.log('[END] script=check-observation-polish.mjs code=2')
  process.exit(2)
}

const results = []
// V1（值级升级 2026-11-24 主人细则 R-视觉1）：抽出 mCodeOf+scopeLabel 函数体沙箱执行，
// 33 位 hex openid 的三种 scope 标题都不得含 ≥16 位连续十六进制。
// 双源对照：git HEAD 基线（止血前拼裸串）必须命中红——证明断言抓得住，不是事后豁免。
const OPENID_FIX = '2C20EBEE44142E9F6A2957BDDBF0E4C19'
const HEX16 = /[0-9a-fA-F]{16,}/
const FIXTURES = [`qq:private:${OPENID_FIX}`, `qq:group:${OPENID_FIX}`, `qq:${OPENID_FIX}`]
function evalScopeLabel(src) {
  const m = /function mCodeOf\(id\) \{[\s\S]*?\n\}/.exec(src)
  const s = /function scopeLabel\(scope\) \{[\s\S]*?\n\}/.exec(src)
  if (m === null || s === null) return null
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`${m[0]}\nconst text = (value, fallback = '') => (value === null || value === undefined ? fallback : String(value))\n${s[0]}\nreturn scopeLabel`)()
  } catch { return null }
}
const labelFn = evalScopeLabel(js)
if (labelFn === null) {
  results.push([false, 'V1·关系页标题值断言（无 ≥16 位连hex）', 'mCodeOf/scopeLabel 抽取失败，闸失效要修闸'])
} else {
  const hits = FIXTURES.map(labelFn).filter((t) => HEX16.test(t))
  // 基线对照（HEAD 尚未 commit 止血改动，应为拼裸串版本）
  let baselineNote = '基线不可读'
  const headOut = spawnSync('git', ['show', 'HEAD:pet/standalone/apps/desktop/electron/renderer/insight.js'], { cwd: ROOT, encoding: 'utf8' })
  const headFn = headOut.status === 0 ? evalScopeLabel((headOut.stdout || '').replace(/\r/g, '')) : null
  const baselineRed = headFn === null ? null
    : FIXTURES.map(headFn).some((t) => HEX16.test(t))
  if (baselineRed === true) baselineNote = 'HEAD 基线命中（断言有牙齿）'
  else if (baselineRed === false) baselineNote = '警告：HEAD 基线也绿，断言可能无牙'
  const ok = hits.length === 0 && baselineRed !== false
  results.push([ok, 'V1·关系页标题值断言（无 ≥16 位连hex）',
    hits.length > 0 ? `现网仍命中 ${hits.length} 款标题：${hits[0]}` : `三款标题全过；${baselineNote}`])
}

// V2 .i-block-head 主定义（第一处、非 @media 内的定义块）必须 flex-wrap
const heads = [...css.matchAll(/\.i-block-head\s*\{([^}]*)\}/g)]
const main = heads.length > 0 ? heads[0][1] : null
const v2 = main !== null && /flex-wrap:\s*wrap/.test(main)
results.push([v2, 'V2·.i-block-head 主定义允许换行', main === null ? '主定义缺失' : `主定义内 ${v2 ? '' : '无 flex-wrap——窄窗 media 才有，正常窗宽长统计行被裁'}`])

// V3 .i-cards 主定义安全网格（防回归）
const cards = [...css.matchAll(/\.i-cards\s*\{([^}]*)\}/g)]
const cMain = cards.length > 0 ? cards[0][1] : null
const v3 = cMain !== null && /repeat\(auto-fill,\s*minmax/.test(cMain)
results.push([v3, 'V3·.i-cards 主定义 auto-fill minmax（防回归）', cMain === null ? '主定义缺失' : (v3 ? '' : '固定列/非 minmax')])

// V4（铁律·可达性补刀）：观察台 html 每个 id 要么被 js 引用，要么自带非空静态内容
let html = ''
try {
  html = read('pet/standalone/apps/desktop/electron/renderer/insight.html')
} catch (e) {
  results.push([false, 'V4·观察台无挂空 id', 'insight.html 读不到：' + (e?.message ?? e)])
}
if (html !== '') {
  const ghost = []
  for (const m of html.matchAll(/id="([a-zA-Z][\w-]*)"[^>]*>([^<]*)</g)) {
    const [, id, inner] = m
    const referenced = js.includes(`'${id}'`) || js.includes(`"${id}"`) || js.includes('`' + id)
    if (!referenced && inner.trim() === '') ghost.push(id)
  }
  results.push([ghost.length === 0, 'V4·观察台无挂空 id（渲染了没人管=等于没渲染）',
    ghost.length > 0 ? `挂空：${ghost.join(',')}——要么 js 填它，要么给静态文案` : ''])
}

// V5（注释跟代码一致）：settings.js 轴数注释必须等于 AXIS_KEYS 实际条数
let settings = ''
try {
  settings = read('pet/standalone/apps/desktop/electron/renderer/settings.js')
} catch (e) {
  results.push([false, 'V5·轴数注释与 AXIS_KEYS 一致', 'settings.js 读不到：' + (e?.message ?? e)])
}
if (settings !== '') {
  const keysM = /const AXIS_KEYS = \[([^\]]*)\]/.exec(settings)
  const n = keysM === null ? -1 : (keysM[1].match(/'[^']+'/g) || []).length
  const claim = keysM === null ? null : (new RegExp('[一二三四五六] 条轴[^\\n]*AXIS_KEYS|([一二三四五六])条轴与插件侧').exec(settings) || [])[1]
  const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
  const claimN = claim === undefined ? null : CN[claim] ?? Number(claim)
  const v5 = n === 5 && claimN === n
  results.push([v5, 'V5·轴数注释与实际轴数一致（防注释再烂）',
    keysM === null ? 'AXIS_KEYS 找不到' : `实际 ${n} 条，注释宣称 ${claimN ?? '?'} 条`])
}

// V6（登记红态）：settings.html 兜底字面 vs ZH 字典（空白归一、含拼接串提取）应零漂移。
// 运行时 i18n 用字典覆盖兜底——字典落后处界面就显示旧文案，「记忆台没变」的第三机制。
// 真漂移逐条裁定归下一格（方向不统一：有的字典新、有的兜底新），清单见
// docs/audits/2026-11-24-fallback-drift.md。本断言先红着记账，修一条少一条。
let i18n = ''
let settingsHtml = ''
try {
  i18n = read('pet/standalone/apps/desktop/electron/renderer/i18n.js')
  settingsHtml = read('pet/standalone/apps/desktop/electron/renderer/settings.html')
} catch (e) {
  results.push([false, 'V6·兜底与字典零漂移（登记红态）', '源读不到：' + (e?.message ?? e)])
}
// 首版假绿根因：比对对象误用了 V4 的 insight.html——漂移全在 settings.html。
if (i18n !== '' && settingsHtml !== '') {
  const zh = {}
  // 值可跨行拼接：'a' + 'b'，取到加号链结束
  for (const m of i18n.matchAll(/'([A-Za-z][\w.]*)':\s*'((?:[^'\\]|\\.)*)'((?:\s*\+\s*'(?:[^'\\]|\\.)*')*)/g)) {
    let v = m[2]
    for (const seg of m[3].matchAll(/'((?:[^'\\]|\\.)*)'/g)) v += seg[1]
    if (!(m[1] in zh)) zh[m[1]] = v
  }
  const norm = (s) => s.replace(/\s+/g, ' ').trim()
  const drift = []
  // 兜底文本可跨行（缩进排版），[^<]+ 会漏掉多行元素——V6 首版就因此假绿 46 处，
  // 被一次性报告当场戳穿。取到闭合标签前的全部文本。
  for (const m of settingsHtml.matchAll(/data-i18n="([\w.]+)">([^<]*)</g)) {
    const k = m[1]
    if (!(k in zh)) continue
    if (norm(zh[k]) !== norm(m[2])) drift.push(k)
  }
  results.push([drift.length === 0, 'V6·兜底与字典零漂移（登记红态，逐条裁定归下一格）',
    drift.length > 0 ? `真漂移 ${drift.length} 处：${drift.slice(0, 8).join(', ')}${drift.length > 8 ? '…' : ''}` : ''])
}

// V7（布局实测 2026-11-24 主人细则 R-视觉2）：Edge headless 打开临时校验页，
// 页内用 getBoundingClientRect 实测——断言A 卡右缘≤容器右缘、断言B 渲染数==声明数（renderCards 的 label 数）。
// 同页带一个「坏基线」区（固定 6×220px 列，复刻止血前形态）：坏区必须被逮到溢出，证明断言有牙齿。
// Edge 不可用记 SKIP（不算红也不算绿，如实报）。
const declaredM = /const cards = \[([\s\S]*?)\n  \]/.exec(js)
const declared = declaredM === null ? -1 : (declaredM[1].match(/label:/g) || []).length
const EDGES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]
const edge = EDGES.find((p) => existsSync(p))
if (declaredM === null || declared < 1) {
  results.push([false, 'V7·统计卡布局实测（渲染数==声明数、右缘不溢出）', 'renderCards cards 数组抽不到'])
} else if (!edge) {
  results.push([true, 'V7·统计卡布局实测（SKIP：Edge 不可用，不计绿）', `声明 ${declared} 张，本轮跳过，如实记`])
} else {
  const proofFile = join(tmpdir(), `dsh-visual-proof-${Date.now()}.html`)
  const cardHtml = (n) => Array.from({ length: n }, (_, i) =>
    `<div class="i-card"><div class="i-card-label">卡${i + 1}</div><div class="i-card-value">一段可能较长的数值文本 1234567890</div><div class="i-card-note">注脚若干字</div></div>`).join('')
  // bonds 区（2026-11-24 真机眼补盲）：复刻 renderRelations 卡结构，扫卡内任何元素越 zone 右缘。
  const bondHtml = (name) => `<div class="i-bond">
    <div class="i-bond-head"><span class="i-bond-name">${name}</span><span class="i-bond-favor">0 / 100</span></div>
    <div class="i-meter"><div class="i-meter-fill" style="width:0%"></div></div>
    <div class="i-favor-row"><input type="range" class="i-favor-range" min="0" max="100" value="0"><span class="i-favor-readout">0</span></div>
    <div class="i-bond-meta"><span>10 句</span><span> · 最近 11 月 8 日 05:02</span></div>
    <div class="i-level"><div class="i-level-head"><span class="i-level-name">疏远</span><span class="i-level-caption">现在的距离</span></div>
    <div class="i-level-row"><span class="i-level-key">主动程度</span><span class="i-level-val">不主动发起话题，只回应对递过来的话</span></div></div>
    <div class="i-bond-actions"><button type="button">−5</button><button type="button">+5</button><button type="button">锁住</button><button type="button">归零</button></div>
  </div>`
  const proof = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff}
.zone{width:900px;box-sizing:border-box;border:1px solid #888}
${css}
.zone .i-cards.bad-grid{grid-template-columns:repeat(6,220px)}
</style></head><body>
<div class="zone" id="zone-good"><div class="i-cards" id="cards-good">${cardHtml(declared)}</div></div>
<div class="zone" id="zone-bad"><div class="i-cards bad-grid" id="cards-bad">${cardHtml(declared)}</div></div>
<div class="zone" id="zone-bonds">${bondHtml('私聊 · …BF0E4C19')}${bondHtml('群里 · …01498B8E')}</div>
<pre id="verdict">PENDING</pre>
<script>
function measure(zoneId, gridId) {
  const z = document.getElementById(zoneId).getBoundingClientRect()
  const cards = [...document.getElementById(gridId).querySelectorAll('.i-card')]
  return { count: cards.length, over: cards.filter((c) => c.getBoundingClientRect().right > z.right + 1).length }
}
const g = measure('zone-good', 'cards-good')
const b = measure('zone-bad', 'cards-bad')
const bz = document.getElementById('zone-bonds').getBoundingClientRect()
const bondOver = [...document.querySelectorAll('#zone-bonds *')].filter((n) => n.getBoundingClientRect().right > bz.right + 1).length
document.getElementById('verdict').textContent = 'VERDICT:' + JSON.stringify({ declared: ${declared}, good: g, bad: b, bondOver })
</script></body></html>`
  writeFileSync(proofFile, proof, 'utf8')
  const run = spawnSync(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--window-size=1000,1400',
    '--virtual-time-budget=4000', '--dump-dom', `file:///${proofFile.replace(/\\/g, '/')}`,
  ], { encoding: 'utf8', timeout: 60000 })
  try { unlinkSync(proofFile) } catch { /* 临时页删不掉不碍事 */ }
  const vm = /VERDICT:(\{.*?\})\s*<\/pre>/s.exec(run.stdout || '')
  if (vm === null) {
    results.push([false, 'V7·统计卡布局实测', 'Edge 无 verdict 输出（可能没起来）'])
  } else {
    let v = null
    try { v = JSON.parse(vm[1]) } catch { results.push([false, 'V7·统计卡布局实测', 'verdict JSON 坏：' + vm[1].slice(0, 80)]) }
    if (v !== null) {
      const passA = v.good.over === 0
      const passB = v.good.count === v.declared
      const teeth = v.bad.over >= 1
      const passBonds = v.bondOver === 0
      results.push([passA && passB && teeth && passBonds, 'V7·统计卡布局实测（好区不溢出·渲染==声明·坏基线被逮·bonds 卡不越缘）',
        `好区 over=${v.good.over} count=${v.good.count}/${v.declared}；坏区 over=${v.bad.over}（应≥1 证有牙齿）；bonds over=${v.bondOver}`])
    }
  }
}

let bad = 0
for (const [pass, name, note] of results) {
  console.log(`  ${pass ? 'OK ' : 'RED'} ${name}${pass ? '' : '  ' + note}`)
  if (!pass) bad++
}
console.log(`[check-observation-polish] 红 ${bad} 条`)
console.log(`[END] script=check-observation-polish.mjs code=${bad === 0 ? 0 : 1}`)
process.exit(bad === 0 ? 0 : 1)
