/**
 * check-settings-nav.mjs —— 设置页导航可达性闸（C1-C3 / t335）
 *
 * 为什么要有这个文件：
 *   设置页十个一级导航按钮里有五个点了完全没反应，五个面板（persona / emotion /
 *   talk / advanced / disclaimer，装着昵称、七段人格、全部气泡与聊天设置）永远打不开。
 *   控件都渲染进 DOM 了，schema 字段也在，i18n 文案双语齐备 —— 断的只是查表：
 *   settings.js 的 PANEL_GROUPS 键用 self/talk/active，settings.html 的 data-group
 *   写 identity/speech/proactive，advanced 与 disclaimer 两组干脆没有。
 *   查不到就 `return`，无提示、无 console、无高亮变化。
 *
 *   这类故障有个共同形状：**四个锚各说各话，没有任何一处把它们对在一起**。
 *     锚① HTML 按钮 data-group      锚② JS 分组键 PANEL_GROUPS
 *     锚③ HTML 面板 div data-panel   锚④ i18n 的 nav.* / panel.*
 *   人肉核对过一次不代表下次改完还对。这个闸把「四锚必须闭合」变成每次 check 都跑的断言。
 *
 * 断言分十组，任何一组红都意味着某个按钮或某个面板在用户手上是死的：
 *   A 导航可达   每个 data-group 在 PANEL_GROUPS 里有键（否则点了静默无反应）
 *   B 无幽灵面板 每组 panels 里的名字在 HTML 里真有 div（否则切过去清光 active → 白屏）
 *   C 面板可达   每个 HTML 面板 div 都被某个组覆盖（否则该面板永远进不去）
 *   D 页头元数据 每个面板在 PANEL_META 里有 titleKey/descKey（否则页头回落到 general，标题写错）
 *   E 文案存在   labelKey / titleKey / descKey / 按钮 data-i18n 在 i18n.js 里都有词条（中英两份都要）
 *   F 子标签一致 子标签的 data-group 与 data-panel 两边都对得上
 *   G 深链可达   LEGACY_PANELS 的值必须是真实面板（否则旧链接改道到不存在的页）
 *   H 回退安全   `PANEL_GROUPS[x] ?? PANEL_GROUPS.y` 里的 y 必须真的存在（否则回退本身抛 TypeError）
 *   I 一词一锚   同一个概念在四锚上不许有两个名字（active 那种歧义词直接判红）
 *   J 闸自验     解析器自己得抓到东西，抓到 0 个就说明正则失效、整份报告不可信
 *
 * 用法：node scripts/check-settings-nav.mjs
 *   通过打 [END] script=check-settings-nav.mjs code=0，失败 code=1。
 *
 * 实现前提（写清，别当它是通用 HTML 解析器）：
 *   这里用正则 + 对象字面量求值，不是 DOM 解析。成立的条件是
 *   PANEL_GROUPS / PANEL_META / LEGACY_PANELS 三个常量保持「纯字面量」形态
 *   （字符串与数组，不含函数、不含花括号字面量嵌在字符串里）。
 *   谁要是把它们改成函数返回值或加了模板串，J 组会先红。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RENDERER = join(HERE, '..', 'pet', 'standalone', 'apps', 'desktop', 'electron', 'renderer')

const read = (name) => readFileSync(join(RENDERER, name), 'utf8')
const html = read('settings.html')
const js = read('settings.js')
const i18n = read('i18n.js')

/* ---------------- 解析：三个常量表 ---------------- */

/**
 * 从 openIdx 的 '{' 起找到配对的 '}'，返回下标；找不到返回 -1。
 *
 * 这里带完整状态机：字符串内（' " ` 三种）、行注释、块注释里的花括号一律不算。
 * 第一版写成裸计数，被 i18n 文案里的引号和注释带跑过 —— 解析器算错一处，
 * 整份报告就是假的，比没有报告更坏。
 */
function matchBraces (src, openIdx) {
  let depth = 0
  let quote = null
  let esc = false
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i]
    if (quote !== null) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? src.length : nl
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 1
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 抓 `const NAME = { ... }` 的花括号配对体并求值。
 * 只适用于纯字面量（字符串与数组，不含函数）。
 */
function extractLiteral (src, name) {
  const head = `const ${name} = {`
  const start = src.indexOf(head)
  if (start === -1) return null
  const open = src.indexOf('{', start)
  const close = matchBraces(src, open)
  if (close === -1) return null
  try {
    // eslint-disable-next-line no-new-func -- 只吃自己仓里的常量字面量，不接外部输入
    return new Function(`return ${src.slice(open, close + 1)}`)()
  } catch {
    return null
  }
}

/** 数组版：抓 `const NAME = [ ... ]` 并求值，前提同上（纯字面量）。 */
function extractArrayLiteral (src, name) {
  const head = `const ${name} = [`
  const start = src.indexOf(head)
  if (start === -1) return null
  const open = src.indexOf('[', start)
  let depth = 0
  let quote = null
  let esc = false
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (quote !== null) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? src.length : nl; continue }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        try {
          // eslint-disable-next-line no-new-func -- 只吃自己仓里的常量字面量
          return new Function(`return ${src.slice(open, i + 1)}`)()
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const PANEL_GROUPS = extractLiteral(js, 'PANEL_GROUPS')
const PANEL_META = extractLiteral(js, 'PANEL_META')
const LEGACY_PANELS = extractLiteral(js, 'LEGACY_PANELS')

/* ---------------- 解析：HTML 三个区 ---------------- */

function sliceBetween (src, fromMarker, toMarker) {
  const a = src.indexOf(fromMarker)
  if (a === -1) return ''
  const b = src.indexOf(toMarker, a)
  return b === -1 ? src.slice(a) : src.slice(a, b)
}

const navBlock = sliceBetween(html, '<nav class="s-nav-list" id="nav">', '</nav>')
const subnavBlock = sliceBetween(html, '<div class="s-subnav" id="subnav"', '<main')

/** 一级导航按钮：nav 块里只带 data-group 的 button，顺带取它 span 上的 data-i18n */
const navButtons = [...navBlock.matchAll(/<button[^>]*\bdata-group="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .map((m) => {
    const i18nMatch = /data-i18n="([^"]+)"/.exec(m[2] ?? '')
    return { group: m[1], i18nKey: i18nMatch ? i18nMatch[1] : null }
  })

/** 面板 div：class 里含 panel 且带 data-panel */
const panelDivs = [...html.matchAll(/<div\s+class="panel(?:\s+active)?"\s+data-panel="([^"]+)"/g)].map((m) => m[1])

/** 子标签按钮：同时带 data-panel 与 data-group */
const subnavButtons = [...subnavBlock.matchAll(/data-panel="([^"]+)"\s+data-group="([^"]+)"/g)]
  .map((m) => ({ panel: m[1], group: m[2] }))

/* ---------------- 解析：i18n 词条与语言块 ---------------- */

/**
 * i18n.js 的语言块是 `const ZH = { ... }` / `const EN = { ... }`（大写常量名），
 * 不是 zh: / en: 属性。按块分别收集键，「中文有英文没有」才查得出来 ——
 * 只收一份会把缺翻译漏掉。
 */
function collectI18nKeys (src) {
  const blocks = {}
  for (const [lang, constName] of [['zh', 'ZH'], ['en', 'EN']]) {
    const head = `const ${constName} = {`
    const start = src.indexOf(head)
    if (start === -1) { blocks[lang] = null; continue }
    const open = src.indexOf('{', start)
    const close = matchBraces(src, open)
    if (close === -1) { blocks[lang] = null; continue }
    const body = src.slice(open, close + 1)
    blocks[lang] = new Set([...body.matchAll(/'([A-Za-z0-9_.\-]+)'\s*:/g)].map((x) => x[1]))
  }
  return blocks
}
const I18N = collectI18nKeys(i18n)
const i18nHas = (key) => {
  const zh = I18N.zh
  const en = I18N.en
  return {
    zh: zh !== null ? zh.has(key) : null,
    en: en !== null ? en.has(key) : null,
  }
}

/* ---------------- 断言 ---------------- */

const cases = []
const ok = (name, cond, detail = '') => cases.push({ name, ok: cond === true, detail })
const bad = (name, detail) => cases.push({ name, ok: false, detail })

const groupKeys = PANEL_GROUPS === null ? [] : Object.keys(PANEL_GROUPS)
const allGroupPanels = groupKeys.flatMap((g) => PANEL_GROUPS[g].panels ?? [])
const metaKeys = PANEL_META === null ? [] : Object.keys(PANEL_META)
const panelSet = new Set(panelDivs)

/* J 组先跑：解析器失效时后面全是假绿 */
ok('J·解析到 PANEL_GROUPS', PANEL_GROUPS !== null && groupKeys.length > 0, `键数=${groupKeys.length}`)
ok('J·解析到 PANEL_META', PANEL_META !== null && metaKeys.length > 0, `键数=${metaKeys.length}`)
ok('J·解析到 LEGACY_PANELS', LEGACY_PANELS !== null, LEGACY_PANELS === null ? 'null' : 'ok')
ok('J·解析到一级导航按钮', navButtons.length > 0, `个数=${navButtons.length}`)
ok('J·解析到面板 div', panelDivs.length > 0, `个数=${panelDivs.length}`)
ok('J·解析到子标签按钮', subnavButtons.length > 0, `个数=${subnavButtons.length}`)
ok('J·解析到 i18n 中文块', I18N.zh !== null && I18N.zh.size > 0, `词条=${I18N.zh ? I18N.zh.size : 0}`)
ok('J·解析到 i18n 英文块', I18N.en !== null && I18N.en.size > 0, `词条=${I18N.en ? I18N.en.size : 0}`)

/* A 组：导航可达 —— 这一组就是「五颗哑按钮」的正身 */
for (const btn of navButtons) {
  ok(`A·导航 data-group="${btn.group}" 在 PANEL_GROUPS 里有键`,
    groupKeys.includes(btn.group),
    groupKeys.includes(btn.group) ? '' : `PANEL_GROUPS 现有键=[${groupKeys.join(', ')}]`)
}

/* B 组：无幽灵面板 —— 组里写了 HTML 没有的面板名，切过去会清光 active 变白屏 */
for (const g of groupKeys) {
  for (const p of (PANEL_GROUPS[g].panels ?? [])) {
    ok(`B·组 "${g}" 的面板 "${p}" 在 HTML 里有 div`, panelSet.has(p),
      panelSet.has(p) ? '' : `HTML 现有面板=[${panelDivs.join(', ')}]`)
  }
}

/* C 组：面板可达 —— 每个 div 都得被某个组收着，否则永远进不去 */
for (const p of panelDivs) {
  ok(`C·面板 "${p}" 被某个组覆盖（可达）`, allGroupPanels.includes(p),
    allGroupPanels.includes(p) ? '' : '不在任何 PANEL_GROUPS[*].panels 里')
}

/* D 组：页头元数据 —— 缺了会回落到 PANEL_META.general，标题写成别的页 */
for (const p of panelDivs) {
  const meta = PANEL_META === null ? undefined : PANEL_META[p]
  ok(`D·面板 "${p}" 在 PANEL_META 里有元数据`, meta !== undefined,
    meta === undefined ? `PANEL_META 现有键=[${metaKeys.join(', ')}]` : '')
  if (meta !== undefined) {
    ok(`D·面板 "${p}" 的 titleKey 有值`, typeof meta.titleKey === 'string' && meta.titleKey !== '', String(meta.titleKey))
    ok(`D·面板 "${p}" 的 descKey 有值`, typeof meta.descKey === 'string' && meta.descKey !== '', String(meta.descKey))
  }
}

/* D 反向：PANEL_META 里不许留幽灵条目 —— 面板删了元数据没删，是下一轮白屏的种子 */
for (const p of metaKeys) {
  ok(`D·PANEL_META 里的 "${p}" 在 HTML 里真有面板 div`, panelSet.has(p),
    panelSet.has(p) ? '' : '幽灵元数据：面板已不存在，条目还留着')
}

/* A 反向：PANEL_GROUPS 里不许留孤儿组 —— 改名改一半留下的旧键就藏在这 */
const navGroupSet = navButtons.map((b) => b.group)
for (const g of groupKeys) {
  ok(`A·组 "${g}" 有对应的一级导航按钮（不是旧词残留）`, navGroupSet.includes(g),
    navGroupSet.includes(g) ? '' : `HTML 导航按钮的 data-group=[${navGroupSet.join(', ')}]`)
}

/* E 组：文案存在 —— 中英两份都要有，切英文才不露键名 */
const checkI18nKey = (key, where) => {
  if (typeof key !== 'string' || key === '') return
  const hit = i18nHas(key)
  ok(`E·${where} 的 i18n "${key}" 中文有词条`, hit.zh === true, hit.zh === null ? 'i18n 中文块未解析' : '')
  ok(`E·${where} 的 i18n "${key}" 英文有词条`, hit.en === true, hit.en === null ? 'i18n 英文块未解析' : '')
}
for (const g of groupKeys) checkI18nKey(PANEL_GROUPS[g].labelKey, `组 "${g}" labelKey`)
for (const p of panelDivs) {
  const meta = PANEL_META === null ? undefined : PANEL_META[p]
  if (meta !== undefined) {
    checkI18nKey(meta.titleKey, `面板 "${p}" titleKey`)
    checkI18nKey(meta.descKey, `面板 "${p}" descKey`)
  }
}
for (const btn of navButtons) {
  if (btn.i18nKey !== null) checkI18nKey(btn.i18nKey, `导航按钮 data-group="${btn.group}"`)
}

/* F 组：子标签一致 —— 子标签按 data-group 过滤，词表不一致会出现空的子标签条 */
for (const s of subnavButtons) {
  ok(`F·子标签 "${s.panel}" 的 data-group="${s.group}" 是合法组`, groupKeys.includes(s.group),
    groupKeys.includes(s.group) ? '' : `PANEL_GROUPS 现有键=[${groupKeys.join(', ')}]`)
  ok(`F·子标签 "${s.panel}" 在 HTML 里有面板 div`, panelSet.has(s.panel), '')
  const owner = groupKeys.find((g) => (PANEL_GROUPS[g].panels ?? []).includes(s.panel))
  ok(`F·子标签 "${s.panel}" 的 data-group 与它实际所属组一致`, owner === s.group,
    owner === s.group ? '' : `实际属于组 "${owner ?? '(无组)'}"，标签写的是 "${s.group}"`)
}

/* G 组：深链可达 —— LEGACY_PANELS 把旧名字改道，改到不存在的面板等于断链 */
if (LEGACY_PANELS !== null) {
  for (const [from, to] of Object.entries(LEGACY_PANELS)) {
    ok(`G·深链 "${from}" → "${to}" 的目标面板存在`, panelSet.has(to),
      panelSet.has(to) ? '' : `HTML 现有面板=[${panelDivs.join(', ')}]`)
  }
}

/* H 组：回退安全 —— `PANEL_GROUPS[x] ?? PANEL_GROUPS.y` 的 y 必须存在，否则回退自己抛 TypeError */
for (const m of js.matchAll(/PANEL_GROUPS\[[^\]]+\]\s*\?\?\s*PANEL_GROUPS\.([A-Za-z0-9_]+)/g)) {
  ok(`H·PANEL_GROUPS 回退目标 "${m[1]}" 真实存在`, groupKeys.includes(m[1]),
    groupKeys.includes(m[1]) ? '' : `PANEL_GROUPS 现有键=[${groupKeys.join(', ')}]，回退会拿到 undefined`)
}
for (const m of js.matchAll(/PANEL_META\[[^\]]+\]\s*\?\?\s*PANEL_META\.([A-Za-z0-9_]+)/g)) {
  ok(`H·PANEL_META 回退目标 "${m[1]}" 真实存在`, metaKeys.includes(m[1]),
    metaKeys.includes(m[1]) ? '' : `PANEL_META 现有键=[${metaKeys.join(', ')}]`)
}

/* I 组：一词一锚 —— 同一个概念在四锚上不许有两个名字 */
const AMBIGUOUS = ['active', 'general', 'self']
for (const g of groupKeys) {
  ok(`I·组名 "${g}" 不是歧义词（与状态/回退撞义）`, !AMBIGUOUS.includes(g),
    AMBIGUOUS.includes(g) ? '这个词同时被用作 enabled/active 状态与回退目标，读代码的人分不清' : '')
}
/* 组名与该组第一个面板名不该是同音不同字（例如组 talk 里面板也叫 talk 是允许的，
   但组 self 里面板叫 persona 就是两个词指一件事）——只报不判死，留给归一那一步。 */
for (const g of groupKeys) {
  const panels = PANEL_GROUPS[g].panels ?? []
  if (panels.length > 0 && !panels.includes(g) && !AMBIGUOUS.includes(g)) {
    cases.push({
      name: `I·组 "${g}" 与它的面板 [${panels.join(', ')}] 用词一致`,
      ok: false,
      detail: '组名与面板名指同一概念却不同词；四锚归一时一并收（第二步，非本闸阻塞项）',
      soft: true,
    })
  }
}

/* K 组：MODULE_RESETS 的落点 —— 它跟 PANEL_GROUPS 平行（group 只跟 HTML 的
   data-reset-module 比），但 panel 字段决定「清除本模块设置」注入到哪个面板。
   指向不存在的面板时 :794 会静默 continue，那颗危险操作按钮就从来没出现过。
   本批不修（修它会新增一个用户可见按钮，属于功能变化），先记成软提示，t336。 */
const MODULE_RESETS = extractArrayLiteral(js, 'MODULE_RESETS')
if (MODULE_RESETS !== null) {
  for (const entry of MODULE_RESETS) {
    if (typeof entry?.panel !== 'string') continue
    if (!panelSet.has(entry.panel)) {
      cases.push({
        name: `K·MODULE_RESETS 组 "${entry.group}" 的落点面板 "${entry.panel}" 存在`,
        ok: false,
        soft: true,
        detail: 'injectModuleResets 会静默跳过，「清除本模块设置」按钮不会出现（t336）',
      })
    }
  }
}

/*
 * ---------------- N 组：nav.* 与 PANEL_GROUPS 键同词（第二步起手） ----------------
 * 2026-11-23 定案：以 div 词为准，nav.* 往 panel 侧靠，双语各改三个键。
 * 这一组当下必须红 —— 红的就是 identity / speech / proactive 三处不同词。
 * 若全绿，说明断言没照到差异（键集为空或取错字段），必须回去改断言，不许往下改键。
 */
// 前置非空：groupKeys 若解析为空，下面每个循环都零迭代，「没有不同词的组」会恒成立成假绿。
// 这条就是补上被点出的那个洞——集合为空时判据不算通过，算无效。
ok('N·被查的分组键集合非空', groupKeys.length > 0, `键数=${groupKeys.length}`)

for (const g of groupKeys) {
  const want = `nav.${g}`
  const got = PANEL_GROUPS[g] === undefined ? undefined : PANEL_GROUPS[g].labelKey
  ok(`N·分组「${g}」labelKey 与键同词`, got === want, `实为 ${String(got)}，期望 ${want}`)
  const has = i18nHas(want)
  ok(`N·i18n 双语都有「${want}」`, has.zh === true && has.en === true, `zh=${String(has.zh)} en=${String(has.en)}`)
}

/* labelKey 引用的键本身必须存在，改了名字没同步双语会红在这里 */
for (const g of groupKeys) {
  const k = PANEL_GROUPS[g] === undefined ? null : PANEL_GROUPS[g].labelKey
  if (typeof k !== 'string') { bad(`N·分组「${g}」有 labelKey`, '缺失'); continue }
  const has = i18nHas(k)
  ok(`N·labelKey「${k}」双语都存在`, has.zh === true && has.en === true, `zh=${String(has.zh)} en=${String(has.en)}`)
}

/*
 * HTML 侧引用不悬空：每个 data-i18n="nav.*" 都要能在双语里查到。
 * 改 i18n 键名而没同步 settings.html 时，靠 span 里的静态中文兜着，
 * 中文界面看不出问题、英文界面会残留中文 —— 所以这条得单独照住。
 */
const htmlNavRefs = [...new Set([...html.matchAll(/data-i18n="(nav\.[A-Za-z]+)"/g)].map((m) => m[1]))]
ok('N·解析到 HTML 的 nav.* 引用', htmlNavRefs.length > 0, `引用数=${htmlNavRefs.length}`)
for (const k of htmlNavRefs) {
  const has = i18nHas(k)
  ok(`N·HTML data-i18n="${k}" 双语都存在`, has.zh === true && has.en === true, `zh=${String(has.zh)} en=${String(has.en)}`)
}

/*
 * ---------------- K 组：data-group 能不能收成 div 名（① 起手先证红） ----------------
 * 定下的验法：data-group 现在还是 identity / speech / proactive 这类组名，
 * 而面板侧用的是 data-panel 值（persona / talk / account …），两者不同词，当下必红。
 * 这条断言同时把结构基数摊开：一个组挂多个面板时，「那个 div 名」根本不存在唯一解，
 * 硬要收只能选其中一个、把其余面板的组名改成它，语义反而更错。所以多面板组报 soft，不硬判。
 * 前置非空：groups 解析为空时下面全是零迭代假绿，先判无效。
 */
const kMulti = groupKeys.filter((g) => Array.isArray(PANEL_GROUPS[g].panels) && PANEL_GROUPS[g].panels.length > 1)
const kSingle = groupKeys.filter((g) => Array.isArray(PANEL_GROUPS[g].panels) && PANEL_GROUPS[g].panels.length === 1)
ok('K·PANEL_GROUPS 解析非空（空则本组全为假绿）', groupKeys.length > 0, `组数=${groupKeys.length}`)
ok('K·单面板组与多面板组合起来覆盖全部组', kSingle.length + kMulti.length === groupKeys.length,
  `单=${kSingle.length} 多=${kMulti.length} 总=${groupKeys.length}`)
// 面板侧集合必须与 HTML 的 data-panel 对得上，否则「div 名」这个前提本身是空的
ok('K·HTML 的 data-panel 集合非空', panelDivs.length > 0, `个数=${panelDivs.length}`)
ok('K·PANEL_GROUPS 里引用的面板全部在 HTML 存在',
  allGroupPanels.every((p) => panelSet.has(p)),
  allGroupPanels.filter((p) => !panelSet.has(p)).join(', ') || '全部命中')

for (const g of kSingle) {
  const panel = PANEL_GROUPS[g].panels[0]
  cases.push({
    /*
     * 2026-11-23 定 B：组名是概念层、data-panel 是实现层，两层各有词是本设计而非待清的脏。
     * 「单面板组的组名必须等于面板名」这句判据的覆盖范围写错了——它假设的是一对一，
     * 而 PANEL_TO_GROUP 承载的是一对多。登记为特例、继续报出，不再当阻塞性硬红。
     * 已知两处一对一仍不同词：look→general、outside→account。将来若收成一个词，本条自动转绿。
     */
    name: `K·单面板组「${g}」组名与面板名不同词（两层词，已登记特例）`,
    ok: g === panel, soft: true,
    detail: `data-group=${g}  data-panel=${panel}`,
  })
}

/*
 * 这里原本要再加一段「子标签 data-group 与派生归属一致」的判据，写完才发现
 * F 组 :298 已经在做同一件事（且用的是 subnavButtons 的真实元素结构 {panel, group}）。
 * 重复实现只会造出假红，故删除；桥接表承重处由 F 组那三条覆盖。
 */

/*
 * 撞字：一个词既是组名、又是别组的面板名。
 * 点导航按 data-group 查 PANEL_GROUPS，走深链按 panel 名查 PANEL_TO_GROUP，
 * 两条路对同一个词会给出不同答案。自名自用（ability/memory/advanced/disclaimer）算正常。
 */
for (const p of new Set(allGroupPanels)) {
  if (!groupKeys.includes(p)) continue
  const owners = groupKeys.filter((g) => g !== p && PANEL_GROUPS[g].panels.includes(p))
  ok(`K·词「${p}」没有被别的组当面板名占用`, owners.length === 0,
    owners.length ? `它是组名，同时又是组 [${owners.join(',')}] 下的面板名 → 深链 #${p} 与按钮 data-group="${p}" 两种解释` : '自名自用，正常')
}
if (kMulti.length > 0) {
  cases.push({
    // 报告器只打印 ok:false 的条目（soft 亦然），这里必须写 false 才会现形；
    // 上一版写 ok:true 让它成了一条永不显示的死判据，只占条数不报事实。
    name: 'K·多面板组无唯一 div 名可收（结构事实，非可修项）', ok: false, soft: true,
    detail: kMulti.map((g) => `${g}→[${PANEL_GROUPS[g].panels.join(' ')}]`).join('  '),
  })
}

/* ---------------- 出报告 ---------------- */
let hard = 0
let soft = 0
for (const c of cases) {
  if (c.ok === true) continue
  if (c.soft === true) {
    soft += 1
    console.log(`  soft ${c.name}${c.detail ? `  →  ${c.detail}` : ''}`)
  } else {
    hard += 1
    console.log(`  RED  ${c.name}${c.detail ? `  →  ${c.detail}` : ''}`)
  }
}
console.log(`[check-settings-nav] 共 ${cases.length} 条，硬红 ${hard} 条，软提示 ${soft} 条`)
console.log(`[END] script=check-settings-nav.mjs code=${hard === 0 ? 0 : 1}`)
process.exit(hard === 0 ? 0 : 1)
