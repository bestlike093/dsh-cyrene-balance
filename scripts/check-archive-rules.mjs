/**
 * 归档规则尺（审计专用 · 非交付件，未进主树 registry）· R-ARCH-1..5 的活性
 *
 * 你裁的五条逐条跑成断言，不留文案：
 *   R-ARCH-1 同值唯一档：同 sections 只一份占 HEAD 候选；其余 superseded 不删、移出候选；
 *            supersededBy 留空须注「同值唯一档，无重复可比」。
 *   R-ARCH-2 保留两类：① [待裁帧·抄改前现场]（须带 frameId/触发行/who/完整 sha/mtime）
 *            ② 当前 --live 权威档（judgeArchive 读它）。② 是角色，可与 ① 同档。
 *   R-ARCH-3 引用驱动，不用到期清理：有现场/判据引用者留，无引用者 superseded；
 *            实体留工作区标 [仅工作区可复现·不进 HEAD 不进包]；聚合索引按 sections 值一行。
 *   R-ARCH-4 每批收口只走一次两步一体；跨帧必带 frameId；只有待裁帧现场进 HEAD 候选。
 *   R-ARCH-5 裁定看 check-baseline-stale --live；--rerun 仅同步，drift 0 ≠ 合规。
 * 手工挂行活性（你补）：登记表里指向 baseline-snapshots/ 的行必须标 生成来源=手工挂行，
 *   未标即红 —— 不许静默消失，也不许静默保留。标记形状受枚举约束，防退化成贴标签。
 *
 * 用法：node scripts/check-archive-rules.mjs [--self-test] [--live <根>]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

/* 判据↔用例绑定（你定）：判据一改，用例集必须重签 EXPECTED_CASE_SIG，否则 --self-test 必红。
   防的是两种反向操作：为过测试改判据、为过判据改测试。 */
export const RULESET_VERSION = 'archive-rules@2026-11-19'
export const EXPECTED_OUTSIDE_SIG = '973da176e60a'
export const EXPECTED_RULESET_VERSION = 'archive-rules@2026-11-19'
export const EXPECTED_SOURCE_HASH = 'f58cf2fe35af2f16'
export const EXPECTED_CASE_SIG = 'e087521cd2667a60'
export const CASE_SIGNATURE = (names, sourceHash) => crypto.createHash('sha1').update(names.join('|') + '#' + String(sourceHash ?? '')).digest('hex').slice(0, 16)

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")

/* 自引用来源扫描：某个归档件被哪些顶层键 / 别的 entry 字段提到 */
export function buildRefSources(log) {
  const map = {}
  for (const e of (log.entries ?? [])) {
    if (!e.snapshotFile) continue
    const list = []
    for (const [k, v] of Object.entries(log)) {
      if (k === 'entries') continue
      if (JSON.stringify(v).includes(e.snapshotFile)) list.push(k)
    }
    for (const x of (log.entries ?? [])) {
      if (!x.snapshotFile || x.snapshotFile === e.snapshotFile) continue
      for (const kk of Object.keys(x)) {
        if (JSON.stringify(x[kk]).includes(e.snapshotFile)) list.push('entry(s' + x.sections + ').' + kk)
      }
    }
    map[e.snapshotFile] = list
  }
  return map
}

const li = process.argv.indexOf('--live')
const LIVE = li > 0 && process.argv[li + 1] ? path.resolve(process.argv[li + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_MODE = li < 0
/* IS_MAIN 守卫：被 import 时不得跑主流程。第三次踩这格（union-pending 之后是 version-registry，
   这次是 rewrite-trace）—— import 触发 process.exit 会把调用方脚本一起带走，输出看着像跑完了其实全空。 */
import { fileURLToPath as __furl } from 'node:url'
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __furl(import.meta.url)
const FIELD_REQUIRED = ['frameId', '触发行', 'who', '完整sha', 'mtime']
const WORKMARK = '[仅工作区可复现·不进 HEAD 不进包]'

const SNAPDIR = (root) => path.join(root, 'docs', 'audits', 'ship-evidence', 'baseline-snapshots')

/** 引用扫描：归档件是否被账本或登记表实际引用（R-ARCH-3 的输入） */
export function collectRefs({ snapDir, ledgerText, registryTexts }) {
  const files = fs.existsSync(snapDir)
    ? fs.readdirSync(snapDir).filter((f) => /^ledger-structure\.baseline-.*\.json$/.test(f) && !/note/.test(f))
    : []
  return files.map((f) => {
    let sections = null
    try { sections = JSON.parse(fs.readFileSync(path.join(snapDir, f), 'utf8')).sections } catch { /* 损坏件按无引用处理 */ }
    const cited = (String(ledgerText || '').split(f).length - 1) + registryTexts.reduce((n, t) => n + (String(t || '').split(f).length - 1), 0)
    return { file: f, sections, 引用次数: cited, 有引用: cited > 0 }
  })
}

/** ② live 角色：待裁帧现场 + 等于当前值 + 类2 明写兼 live 权威档 */
const isLive = (e, liveSections) => e['类'] === '待裁帧现场' && e.sections === liveSections && String(e['类2'] ?? '').includes('live 权威档')

export function judgeRArch({ entries, refs, liveSections }) {
  const bad = []
  const refMap = new Map(refs.map((r) => [r.file, r]))
  const bySec = new Map()
  for (const e of entries) {
    if (!e.snapshotFile) continue
    const sec = e.sections ?? (refMap.get(e.snapshotFile) || {}).sections ?? null
    if (!bySec.has(sec)) bySec.set(sec, [])
    bySec.get(sec).push(e)
  }

  /* R-ARCH-1 同值唯一档 */
  for (const [sec, arr] of bySec) {
    const cand = arr.filter((e) => e['HEAD候选'] === true)
    if (cand.length > 1) bad.push(`R-ARCH-1 违：sections=${sec} 有 ${cand.length} 份占 HEAD 候选（同值必须唯一权威档）`)
    for (const e of arr) {
      if (e.superseded === true && !String(e.supersededBy ?? '').trim()) bad.push(`R-ARCH-1 违：${e.snapshotFile} 标了 superseded 但 supersededBy 留空，须注「同值唯一档，无重复可比」`)
      if (e.superseded === true && String(e.supersededBy).includes('同值唯一档') && arr.length > 1) bad.push(`R-ARCH-1 违：${e.snapshotFile} 拿「同值唯一档」注释顶替真权威（同值实有 ${arr.length} 份，须指名档名）`)
    }
  }

  /* R-ARCH-2 两类并存（② 为角色，只裁它是否存在且唯一） */
  const live = entries.filter((e) => isLive(e, liveSections))
  if (liveSections != null && live.length === 0) bad.push(`R-ARCH-2 违：缺 ② live 权威档（sections=${liveSections}）—— judgeArchive 失去对象，活性常红`)
  if (live.length > 1) bad.push(`R-ARCH-2 违：② live 角色有 ${live.length} 档（当前值角色必须唯一）`)
  for (const s of entries.filter((e) => e['类'] === '待裁帧现场')) {
    const miss = FIELD_REQUIRED.filter((k) => {
      const val = String(s[k] ?? '')
      return !val || /未取到|\(未|待补/.test(val)
    })
    if (miss.length) bad.push(`R-ARCH-2 违：① 现场档 ${s.snapshotFile} 缺字段 ${miss.join('/')}`)
  }

  /* R-ARCH-3 引用驱动 */
  for (const e of entries) {
    if (!e.snapshotFile) continue
    const r = refMap.get(e.snapshotFile)
    if (r && r.有引用 === false && e.superseded !== true && !isLive(e, liveSections)) {
      bad.push(`R-ARCH-3 违：${e.snapshotFile} 零引用却仍占候选（无引用者应 superseded，实体留工作区标 ${WORKMARK}）`)
    }
    if (e.superseded === true && e['工作区标记'] !== WORKMARK) bad.push(`R-ARCH-3 违：${e.snapshotFile} 已 superseded 但未带工作区标记（不删、不进候选、不进包）`)
  }

  /* R-ARCH-4 跨帧必带 frameId；只有待裁帧现场进 HEAD 候选 */
  for (const e of entries) {
    if (!e.snapshotFile) continue
    if (e['类'] === '待裁帧现场' && !String(e.frameId ?? '').trim()) bad.push(`R-ARCH-4 违：${e.snapshotFile} 标了待裁帧现场却无 frameId（跨帧必带）`)
    if (e['HEAD候选'] === true && e['类'] !== '待裁帧现场') bad.push(`R-ARCH-4 违：${e.snapshotFile} 非待裁帧现场却占了 HEAD 候选`)
  }
  const secVals = [...bySec.keys()]
  const candRows = entries.filter((e) => e['HEAD候选'] === true).length
  if (candRows > secVals.length) bad.push(`R-ARCH-3/4 违：候选行 ${candRows} 超过 sections 聚合值数 ${secVals.length}（须按值聚合一行，不为每份单开）`)

  return {
    ok: bad.length === 0, bad,
    统计: {
      条目: entries.filter((e) => e.snapshotFile).length,
      sections唯一值: secVals.length,
      唯一值列表: secVals.sort((a, b) => (a ?? 0) - (b ?? 0)),
      待裁帧现场: entries.filter((e) => e['类'] === '待裁帧现场').length,
      live角色: live.length,
      HEAD候选行: candRows,
    },
  }
}

/** 手工挂行活性 + 标记形状约束（你配的那条） */
export function judgeHandmadeRows({ tableRows, markEnum }) {
  const bad = []
  const rows = (tableRows ?? []).filter((r) => String(r.path).includes('baseline-snapshots/'))
  for (const r of rows) {
    const tag = String(r['生成来源'] ?? '')
    if (!tag.includes('手工挂行')) bad.push(`手工挂行未标注即红：${r.path} —— collect() 不收 baseline-snapshots/，这行是手工挂的，必须写明 生成来源=手工挂行`)
  }
  for (const m of (markEnum ?? [])) {
    const s = String(m)
    const bracketed = s.charCodeAt(0) === 91 && s.charCodeAt(s.length - 1) === 93   /* [ … ] */
    const ledgerRef = s.indexOf('MERGE-LEDGER.md:L') === 0
    if (!bracketed && !ledgerRef) bad.push(`标记枚举退化成自由文本：${s} —— 「明确标记」只能由生成规则产出，否则就是 role=ref 那种贴标签`)
  }
  return { ok: bad.length === 0, bad, 表内归档件行数: rows.length }
}

/** 自测：你点名的两条活性 + 五条各一阴一阳 + 手工挂行一阴一阳 */
/** R-ARCH-6/7/8/9：权威只由 refetch-log.authorityFor 决定，尺子自己绝不选指针、绝不改指针。
 *  尺子只「报告候选」：
 *    R-ARCH-9·一 同 sections 有档但 authorityFor 无指针行 → 红
 *    R-ARCH-6     指针行缺裁定人/时点 → 红（不可核的指针等于没登记）
 *    R-ARCH-7     指针所指档却标 superseded/非候选，或非指针档占候选 → 红（只报告）
 *    R-ARCH-7·二  同组内 supersededBy 互相指向 → 红（上帧实测到的坏形状）
 *    R-ARCH-8     mtime 变化只输出「物理时点变化·非裁定」声明，不改指、不算红
 */
export function judgeAuthority({ entries, authorityFor, mtimeChanges, snapDir, refSources }) {  const bad = []
  const notices = []
  const bySec = new Map()
  for (const e of (entries ?? [])) {
    if (!e.snapshotFile) continue
    if (!bySec.has(e.sections)) bySec.set(e.sections, [])
    bySec.get(e.sections).push(e)
  }
  const auth = new Map((authorityFor ?? []).map((a) => [a.sections, a]))
  for (const [s, arr] of bySec) {
    /* R-ARCH-10 多次写入未收敛：同 sections 且 sha 互异，说明是多次不同写入，不是同一份的拷贝。
       此时不许按引用数 / 帧序 / mtime 自动选；要裁得先答「哪次写入对应哪次账本收口」。
       本判据在指针判据之前跑 —— 指针缺不缺失，都先把「收敛没收敛」说清楚。 */
    const shas = arr.map((e) => {
      const p = snapDir ? path.join(snapDir, e.snapshotFile) : null
      return p && fs.existsSync(p) ? sha256File(p) : (e.sha256 ?? "(拿不到)")
    })
    const uniq = [...new Set(shas)]
    if (uniq.length > 1) {
      bad.push(
        "R-ARCH-10 违：sections=" + s + " 有 " + arr.length + " 档且 sha 互异（" +
        uniq.map((x) => String(x).slice(0, 8)).join(" / ") +
        "）—— 多次写入未收敛，不许按引用数/帧序/mtime 自动选；要裁先答「哪次写入对应哪次账本收口」"
      )
    }
    /* 自引用识别：被别条引用若全部来自 聚合索引 / RARCH4违例记录 / 归一动作写的 supersededBy，
       属「描述标记的文字」，不构成权威依据。 */
    for (const e of arr) {
      const src = (refSources && refSources[e.snapshotFile]) ?? []
      const external = src.filter((x) => !/聚合索引|RARCH4违例记录|归一|supersededBy|依据表|authorityFor|收口日志/.test(x))
      const selfOnly = src.length > 0 && external.length === 0
      if (selfOnly) {
        notices.push("R-ARCH-9 声明：" + e.snapshotFile + " 被引用的 " + src.length + " 处全部为自引用/元数据（" + src.slice(0, 3).join("、") + "），不构成权威依据")
      }
    }
    const a = auth.get(s)
    if (!a || !a['指针']) { bad.push('R-ARCH-6/9 违：sections=' + s + ' 有 ' + arr.length + ' 档但 authorityFor 无指针行 —— 指针缺失即红，脚本不得代选'); continue }
    if (!a['裁定人'] || !a['时点']) bad.push('R-ARCH-6 违：sections=' + s + ' 指针缺裁定元数据（裁定人=' + a['裁定人'] + ' 时点=' + a['时点'] + '）—— 不可核的指针不算登记')
    for (const e of arr) {
      const isAuth = e.snapshotFile === a['指针']
      /* 两轴正交：authorityFor 只解决「同值多份指哪一份」；零引用件按 R-ARCH-3 降出候选，
         指针仍指向它，属正常状态。上帧我把这条判成「指针与候选不一致」是过界——
         127/129 是单份且零引用，被 R-ARCH-3 正当降候选，不该由 R-ARCH-7 报警。
         真不一致只有两种：同值多份里非指针档占了候选（指错档）；指针所指且被账本引用却标 superseded。 */
      if (!isAuth && e['HEAD候选'] === true) bad.push('R-ARCH-7 违：' + e.snapshotFile + ' 非指针所指却占 HEAD 候选 —— 同值多份指错档')
      if (isAuth && arr.length > 1 && e.superseded === true && ((e['引用'] && e['引用']['账本命中行'] || 0) > 0)) bad.push('R-ARCH-7 违：' + e.snapshotFile + ' 为指针所指且被账本引用，却标 superseded —— 指针与引用现场矛盾')
    }
    const cyc = arr.find((e) => e.supersededBy && arr.some((x) => x.snapshotFile === e.supersededBy && x.supersededBy === e.snapshotFile))
    if (cyc) bad.push('R-ARCH-7 违：' + cyc.snapshotFile + ' 与 ' + cyc.supersededBy + ' 的 supersededBy 互相指向 —— 一次动作里既改指又动候选留下的坏形状')
    if (arr.length > 1) notices.push('R-ARCH-8 声明：sections=' + s + ' 共 ' + arr.length + ' 档，指针=' + a['指针'] + '（档间 mtime 差异属物理时点，不触发改指）')
  }
  for (const m of (mtimeChanges ?? [])) notices.push('R-ARCH-8 声明：' + m.file + ' mtime ' + m['旧'] + ' → ' + m['新'] + '，物理时点变化·非裁定，指针未动')
  return { ok: bad.length === 0, bad, notices }
}
/* ── 边界本身要可验（你补）：三层提取互证 ─────────────────────────
   ① Function.prototype.toString() 给出函数整段；
   ② extractByBraces() 从源码里按大括号配平取同名函数体（跳过字符串/模板/注释）；
   ③ 两者归一化后必须相等，不等即红 —— 不让 SOURCE_SCOPE 靠一个没验过的括号计数活着。
   注释口径写死：归一化【不丢注释】，函数体内改一个注释字符也算判据变（所以下面说「改一个字符」含注释）。
   函数外逻辑：文件里三个 judge 之外的「有效逻辑行」（去 import / export const / 空行 / 纯注释）算一个签名，
   该签名进用例集签名 —— 于是把逻辑挪进 helper、或新增一个 judge 函数，绑定会红。 */
export function extractByBraces(source, name) {
  const re = new RegExp('(?:export\\s+)?function\\s+' + name + '\\s*\\(')
  const m = re.exec(source)
  if (!m) return null
  /* 先跳过参数列表：参数解构里也有 { }，从第一个 { 数会把 `({ a })` 当成函数体（本轮实测第三颗同类）。 */
  let j = m.index + m[0].length - 1
  let pd = 0
  let pq = null
  while (j < source.length) {
    const c = source[j]
    if (pq) { if (c === '\\') { j += 2; continue } if (c === pq) pq = null; j += 1; continue }
    if (c === '"' || c === "'" || c === '`') { pq = c; j += 1; continue }
    if (c === '(') pd += 1
    else if (c === ')') { pd -= 1; if (pd === 0) break }
    j += 1
  }
  let i = source.indexOf('{', j + 1)
  if (i < 0) return null
  let depth = 0
  let q = null
  while (i < source.length) {
    const c = source[i]
    if (q) {
      if (c === '\\') { i += 2; continue }
      if (c === q) q = null
      i += 1; continue
    }
    if (c === '"' || c === "'" || c === '`') { q = c; i += 1; continue }
    if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i += 1; continue }
    if (c === '/' && source[i + 1] === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1; i += 2; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return source.slice(m.index, i + 1) }
    i += 1
  }
  return null
}

const normSrc = (s) => String(s).replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').replace(/[ \t]+/g, ' ').replace(/^export\s+/, '')

/** 三层提取互证：toString / 源码配平 / 归一化相等。返回 {ok, bad, pieces} */
export function judgeExtraction(source, fns) {
  const bad = []
  const pieces = {}
  for (const [name, fn] of fns) {
    const byToString = normSrc(fn.toString())
    const byBraces = extractByBraces(source, name)
    if (byBraces === null) { bad.push('大括号边界提取失败：' + name + ' 未找到闭合大括号（未闭合或名字不匹配）'); continue }
    const nb = normSrc(byBraces)
    if (nb !== byToString) bad.push('两套提取器不一致：' + name + ' —— toString 与源码配平结果不同，边界不可信')
    pieces[name] = byToString
  }
  return { ok: bad.length === 0, bad, pieces }
}

/** 体外过滤口径写死（你补：别让 269 变成没人验的底数）· 四条逐类 + 注释分界一句 */
export const OUTSIDE_FILTER_RULES = [
  "去 import 行（以 import 起手的整行）",
  "去 export const 行（含 EXPECTED_* 等登记常量）",
  "去空行（trim 后为空）",
  "去纯注释行（斜杠斜杠 / 星号 / 斜杠星 起手；行尾注释不去，仍算有效）",
]
/**
 * 注释分界（两范围两把尺，写死）：
 *   函数【体内】注释参与 SOURCE_PIECES 哈希 —— 体内改一个注释字符就算判据变；
 *   函数【体外】的纯注释行被上面第 ④ 类整类去掉 —— 体外改注释不算判据变。
 *   下轮若有人改了体外注释又来问「不是说改一个字符就算吗」，答案在这两句里。
 */
export function outsideLogic(source, fns) {
  const bodies = fns.map(([name, fn]) => normSrc(fn.toString()))
  let rest = String(source)
  for (const [name] of fns) {
    const seg = extractByBraces(rest, name) ?? extractByBraces(String(source), name)
    if (seg) rest = rest.replace(seg, '')
  }
  const lines = rest.replace(/\r/g, '').split('\n').map((l) => l.trim())
    .filter((l) => l && !/^\/\//.test(l) && !/^\*/.test(l) && !/^\/\*/.test(l))
    .filter((l) => !/^import\s/.test(l))
    .filter((l) => !/^export const /.test(l))
  const sig = crypto.createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12)
  return { lines, count: lines.length, sig }
}
/* 判据源码哈希：把三个 judge 函数的源码一起哈希。判据一改，这个值就变；
   而 CASE_SIGNATURE 里带它，所以「判据改了 + 期望值手改成新版本 + 用例集没重签」也会被算出来对不上。
   三者绑定：判据版本 / 用例集（含源码哈希）/ 期望值。缺一红。 */
/* 取源范围写死（你补）：
   函数：judgeRArch / judgeHandmadeRows / judgeAuthority —— 只这三个，别处新增逻辑本尺不覆盖（能力边界，交给 review）。
   起止边界：函数名到其闭合大括号（Function.prototype.toString 给出的整段）。
   归一化：统一换行、逐行去首尾空白、丢空行、把行内连续空白折叠为一个空格 ——
     于是「把函数挪个位置」「加个空行」「改缩进」都不算改判据；函数体内改一个字符就会变。 */
export const SOURCE_SCOPE = {
  函数: ["judgeRArch", "judgeHandmadeRows", "judgeAuthority"],
  起止边界: "function 名 → 其闭合大括号",
  归一化: "统一换行 / 逐行 trim / 丢空行 / 行内连续空白折叠",
  不覆盖: "这三个函数之外新增的逻辑 —— 本尺不报",
}
export const SOURCE_PIECES = (() => {
  const pairs = [["judgeRArch", judgeRArch], ["judgeHandmadeRows", judgeHandmadeRows], ["judgeAuthority", judgeAuthority]]
  const out = {}
  for (const [name, fn] of pairs) out[name] = crypto.createHash("sha1").update(normSrc(fn.toString())).digest("hex").slice(0, 12)
  return out
})()
export const RULESET_SOURCE_HASH = crypto.createHash("sha1")
  .update(Object.entries(SOURCE_PIECES).map(([k, v]) => k + ":" + v).join("|"))
  .digest("hex").slice(0, 16)

/* 纯函数：给定版本/用例名/源码哈希/期望值，判绑定是否成立（供自测模拟各种改动帧） */
/* 函数外逻辑守卫（你补）：三个 judge 之外的「有效逻辑行」签名与登记值不符 →
   标 [需人工确认]（不判红：函数外改动可能是无害重构，也可能是把判据逻辑挪走 —— 必须人看，不许静默）。
   全文件 hash 只输出、不参与绑定：注释/空行改动不该被当成判据变。 */
export function judgeOutside({ outsideSig, expectedOutsideSig }) {
  if (!expectedOutsideSig) return { ok: true, needHuman: false, why: '(未登记期望值)' }
  if (outsideSig === expectedOutsideSig) return { ok: true, needHuman: false, why: '函数外签名与登记一致' }
  return { ok: true, needHuman: true, why: '函数外逻辑变了：现 ' + outsideSig + ' ≠ 登记 ' + expectedOutsideSig + ' —— [需人工确认]：是重构，还是把判据挪到了范围内？' }
}
export function judgeBinding({ version, expectedVersion, names, expectedSig, sourceHash, expectedSourceHash }) {
  const bad = []
  if (version !== expectedVersion) bad.push("判据版本不一致：现 " + version + " ≠ 期望 " + expectedVersion)
  if (expectedSourceHash && sourceHash !== expectedSourceHash) bad.push("判据源码变了但期望值未重签：现 " + sourceHash + " ≠ 期望 " + expectedSourceHash)
  const sig = CASE_SIGNATURE(names, sourceHash)
  if (sig !== expectedSig) bad.push("用例集签名不一致：现 " + sig + " ≠ 期望 " + expectedSig + "（判据或用例改过而没重签）")
  return { ok: bad.length === 0, bad, sig }
}
export function selfTest() {
  const cases = []
  const push = (name, ok, got) => cases.push({ name, ok: !!ok, got: String(got) })
  const mk = (o) => ({ snapshotFile: 'x.json', sections: 5, 类: '待裁帧现场', frameId: 'F-1', 触发行: 'MERGE-LEDGER.md:L10', who: '昔涟', 完整sha: 'a'.repeat(64), mtime: '2026-11-18T00:00:00Z', 工作区标记: WORKMARK, 'HEAD候选': false, ...o })
  const refs = (map) => Object.entries(map).map(([file, n]) => ({ file, sections: 5, 引用次数: n, 有引用: n > 0 }))

  /* 活性① 第 7 份零引用归档 */
  const seven = [1, 2, 3, 4, 5, 6].map((i) => mk({ snapshotFile: 's' + i, 'HEAD候选': true }))
  seven.push(mk({ snapshotFile: 's7', 'HEAD候选': true }))
  let r = judgeRArch({ entries: seven, refs: refs({ s1: 2, s2: 1, s3: 1, s4: 1, s5: 1, s6: 1, s7: 0 }), liveSections: 5 })
  push('活性①·第 7 份零引用归档必报并移出候选', r.bad.some((b) => /R-ARCH-3/.test(b) && /s7/.test(b)), r.bad.find((b) => /s7/.test(b)) ?? '(未报)')
  r = judgeRArch({ entries: seven.map((e) => e.snapshotFile === 's7' ? { ...e, superseded: true, supersededBy: 's1', 'HEAD候选': false, 工作区标记: WORKMARK } : e), refs: refs({ s1: 2, s2: 1, s3: 1, s4: 1, s5: 1, s6: 1, s7: 0 }), liveSections: 5 })
  push('活性①·标 superseded 且指名权威后放行', !r.bad.some((b) => /s7/.test(b)), r.bad.find((b) => /s7/.test(b)) ?? 'OK')

  /* 活性② 删掉 live 权威档 */
  r = judgeRArch({ entries: [mk({ snapshotFile: 's1' })], refs: refs({ s1: 1 }), liveSections: 5 })
  push('活性②·删掉 ② live 权威档必报缺 ②', r.bad.some((b) => /R-ARCH-2 违：缺 ②/.test(b)), r.bad.find((b) => /缺 ②/.test(b)) ?? '(未报)')
  const two = [mk({ snapshotFile: 's1', 类2: '(非当前值档)', 'HEAD候选': false, superseded: true, supersededBy: 'live.json' }), mk({ snapshotFile: 'live.json', 类2: '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true })]
  r = judgeRArch({ entries: two, refs: refs({ s1: 1, 'live.json': 0 }), liveSections: 5 })
  push('活性②·两类并存（零引用的当前值档有豁免）才放行', r.ok, JSON.stringify(r.bad))

  /* R-ARCH-1 */
  r = judgeRArch({ entries: [mk({ snapshotFile: 'a', 类2: '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true }), mk({ snapshotFile: 'b', 'HEAD候选': true })], refs: refs({ a: 1, b: 1 }), liveSections: 5 })
  push('R-ARCH-1·同值两份都占候选必报', r.bad.some((b) => /R-ARCH-1 违：sections=5/.test(b)), r.bad.find((b) => /R-ARCH-1/.test(b)) ?? '(未报)')
  r = judgeRArch({ entries: [mk({ snapshotFile: 'a', 类2: '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true }), mk({ snapshotFile: 'b', superseded: true, supersededBy: '' })], refs: refs({ a: 1, b: 1 }), liveSections: 5 })
  push('R-ARCH-1·supersededBy 留空必报', r.bad.some((b) => /supersededBy 留空/.test(b)), r.bad.find((b) => /留空/.test(b)) ?? '(未报)')
  r = judgeRArch({ entries: [mk({ snapshotFile: 'a', 类2: '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true }), mk({ snapshotFile: 'b', superseded: true, supersededBy: '(同值唯一档，无重复可比)' })], refs: refs({ a: 1, b: 1 }), liveSections: 5 })
  push('R-ARCH-1·拿「唯一档」注释顶替真权威必报', r.bad.some((b) => /顶替真权威/.test(b)), r.bad.find((b) => /顶替/.test(b)) ?? '(未报)')

  /* R-ARCH-2 字段 / R-ARCH-4 */
  r = judgeRArch({ entries: [mk({ snapshotFile: 'a', frameId: undefined, 类2: '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true })], refs: refs({ a: 1 }), liveSections: 5 })
  push('R-ARCH-2·现场档缺 frameId 必报并点出缺哪几格', /frameId/.test(r.bad.find((b) => /缺字段/.test(b)) ?? ''), r.bad.find((b) => /缺字段/.test(b)) ?? '(未报)')
  r = judgeRArch({ entries: [mk({ snapshotFile: 'a', 类: 'live权威档', 类2: '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true })], refs: refs({ a: 1 }), liveSections: 5 })
  push('R-ARCH-4·非待裁帧现场占 HEAD 候选必报', r.bad.some((b) => /非待裁帧现场/.test(b)), r.bad.find((b) => /非待裁帧现场/.test(b)) ?? '(未报)')

  /* 手工挂行：一阴一阳 */
  let h = judgeHandmadeRows({ tableRows: [{ path: 'docs/audits/ship-evidence/baseline-snapshots/refetch-log.json' }], markEnum: ['[零引用·R-ARCH-3 已移出候选]'] })
  push('手工挂行·未标注必报（不许静默保留）', h.ok === false && /手工挂行未标注/.test(h.bad[0] ?? ''), h.bad[0] ?? '(未报)')
  h = judgeHandmadeRows({ tableRows: [{ path: 'docs/audits/ship-evidence/baseline-snapshots/refetch-log.json', 生成来源: '手工挂行（非 collect 生成）' }], markEnum: ['[零引用·R-ARCH-3 已移出候选]'] })
  push('手工挂行·标了即放行（靠标注留证，不静默消失）', h.ok === true, JSON.stringify(h.bad))
  h = judgeHandmadeRows({ tableRows: [], markEnum: ['随便写的一句话'] })
  push('标记形状·枚举里混自由文本必报（防退化成贴标签）', h.bad.some((b) => /自由文本/.test(b)), h.bad.find((b) => /自由文本/.test(b)) ?? '(未报)')

  const e1 = { snapshotFile: 'a.json', sections: 5, sha256: 'q'.repeat(64), '类2': '兼 live 权威档（judgeArchive 读它）', 'HEAD候选': true }
  const e2 = { snapshotFile: 'b.json', sections: 5, sha256: 'q'.repeat(64), '类2': '(非当前值档)' }
  const A = [{ sections: 5, '指针': 'a.json', '裁定人': '你', '时点': '2026-11-18T00:00:00Z' }]
  let au = judgeAuthority({ entries: [e1, e2], authorityFor: [], mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-9·一 同值多档但指针缺失 → 必红', ok: au.ok === false && /无指针行/.test(au.bad[0] ?? ''), got: au.bad[0] ?? '(未报)' })
  au = judgeAuthority({ entries: [e1, e2], authorityFor: A, mtimeChanges: [{ file: 'a.json', '旧': '2026-11-17T00:00:00Z', '新': '2026-11-18T00:00:00Z' }] })
  cases.push({ name: 'R-ARCH-9·二 mtime 更新而指针未动 → 不红且输出物理时点声明', ok: au.ok === true && au.notices.some((n) => /非裁定/.test(n)), got: au.notices.join(' ⏎ ') })
  /* 等价新用例：旧用例断言的「单份+零引用被 R-ARCH-3 降候选 → 指针与候选不一致」已被判为过界并删除，
     这里换成收窄后保留的那条：非指针档占 HEAD 候选 → 必红（两轴正交，指针只解决同值多份指哪份）。 */
  au = judgeAuthority({ entries: [e1, { ...e2, 'HEAD候选': true }], authorityFor: A, mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-7·一 非指针档占 HEAD 候选 → 必红（收窄后保留的那条，替代旧「指针与候选不一致」用例）', ok: au.bad.some((b) => /非指针所指却占/.test(b)), got: au.bad.find((b) => /非指针所指/.test(b)) ?? '(未报)' })
  au = judgeAuthority({ entries: [e1, e2], authorityFor: A, mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-7·一 阴性·指针所指且同为候选、无引用 → 不红（两轴正交）', ok: au.ok === true, got: JSON.stringify(au.bad) })
  /* R-ARCH-10 多次写入未收敛 */
  const d1 = { snapshotFile: 'a.json', sections: 7, sha256: 'a'.repeat(64) }
  const d2 = { snapshotFile: 'b.json', sections: 7, sha256: 'b'.repeat(64) }
  const A7 = [{ sections: 7, '指针': 'a.json', '裁定人': '你', '时点': '2026-11-18T00:00:00Z' }]
  au = judgeAuthority({ entries: [d1, d2], authorityFor: A7, mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-10 阳性·同 sections 且 sha 互异 → 必报「多次写入未收敛」', ok: au.bad.some((b) => /多次写入未收敛/.test(b)), got: au.bad.find((b) => /未收敛/.test(b)) ?? '(未报)' })
  au = judgeAuthority({ entries: [{ ...d1, sha256: 'a'.repeat(64) }, { ...d2, sha256: 'a'.repeat(64) }], authorityFor: A7, mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-10 阴性·同 sections 同 sha → 不报未收敛（是同一份的拷贝）', ok: !au.bad.some((b) => /未收敛/.test(b)), got: JSON.stringify(au.bad) })
  /* 自引用不算权威依据 */
  au = judgeAuthority({ entries: [e1, e2], authorityFor: A, mtimeChanges: [], refSources: { 'a.json': ['聚合索引', 'RARCH4违例记录', 'entry(s131).supersededBy'] } })
  cases.push({ name: 'R-ARCH-9 声明·引用全为自引用/元数据 → 记声明，不构成权威依据', ok: au.notices.some((n) => /自引用\/元数据/.test(n)) && au.ok === true, got: au.notices.filter((n) => /自引用/.test(n)).join(' ⏎ ') })
  au = judgeAuthority({ entries: [{ ...e1, supersededBy: 'b.json' }, { ...e2, supersededBy: 'a.json' }], authorityFor: A, mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-7·二 supersededBy 互相指向 → 必红（上帧真实坏形状）', ok: au.bad.some((b) => /互相指向/.test(b)), got: au.bad.find((b) => /互相指向/.test(b)) ?? '(未报)' })
  au = judgeAuthority({ entries: [e1, { ...e2, 'HEAD候选': true }], authorityFor: A, mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-9·三 非指针档占 HEAD 候选 → 必红', ok: au.bad.some((b) => /非指针所指却占/.test(b)), got: au.bad.find((b) => /非指针所指/.test(b)) ?? '(未报)' })
  au = judgeAuthority({ entries: [e1, e2], authorityFor: [{ sections: 5, '指针': 'a.json' }], mtimeChanges: [] })
  cases.push({ name: 'R-ARCH-6 指针缺裁定人/时点 → 必红（不可核指针不算登记）', ok: au.bad.some((b) => /缺裁定元数据/.test(b)), got: au.bad.find((b) => /缺裁定/.test(b)) ?? '(未报)' })
  /* 判据↔用例↔期望值 三件绑定：一阴一阳各在册（本轮补） */
  /* 模拟用例名：不引用 selfTest 自身产生的 cases，避免签名自引用 */
  const names = ["样例A", "样例B", "样例C"]
  const sh = 'SRC_HASH_A'
  const sig = CASE_SIGNATURE(names, sh)
  let bd = judgeBinding({ version: 'v1', expectedVersion: 'v1', names, expectedSig: sig, sourceHash: sh, expectedSourceHash: sh })
  cases.push({ name: '绑定·阴性：版本符 + 源码符 + 签名符 → 放行', ok: bd.ok === true, got: JSON.stringify(bd.bad) })
  bd = judgeBinding({ version: 'v2', expectedVersion: 'v1', names, expectedSig: sig, sourceHash: sh, expectedSourceHash: sh })
  cases.push({ name: '绑定·阳性：只改判据版本 → 必红', ok: bd.ok === false && /版本不一致/.test(bd.bad[0] ?? ''), got: bd.bad[0] ?? '(未报)' })
  bd = judgeBinding({ version: 'v1', expectedVersion: 'v1', names, expectedSig: sig, sourceHash: 'SRC_HASH_B', expectedSourceHash: sh })
  cases.push({ name: '绑定·阳性：只改判据源码 → 必红（源码变了期望没重签）', ok: bd.ok === false && /源码变了/.test(bd.bad[0] ?? ''), got: bd.bad[0] ?? '(未报)' })
  bd = judgeBinding({ version: 'v1', expectedVersion: 'v1', names: names.concat(['新用例']), expectedSig: sig, sourceHash: sh, expectedSourceHash: sh })
  cases.push({ name: '绑定·阳性：只改用例集 → 必红', ok: bd.ok === false && /签名不一致/.test(bd.bad[0] ?? ''), got: bd.bad[0] ?? '(未报)' })
  /* 两边同时改：版本与期望源码哈希都手改成新值，但用例集未重签 */
  const sh2 = 'SRC_HASH_B'
  bd = judgeBinding({ version: 'v2', expectedVersion: 'v2', names, expectedSig: sig, sourceHash: sh2, expectedSourceHash: sh2 })
  cases.push({ name: '绑定·阳性：判据改 + 期望值手改成新值 + 用例集未重签 → 仍必红', ok: bd.ok === false && /签名不一致/.test(bd.bad[0] ?? ''), got: bd.bad[0] ?? '(未报)' })
  /* ── 边界四帧 + 不一致必红（你补：找闭合括号这台机器第三次现身，正例先验它自己） ── */
  const bS1 = 'function bF1({ a, b }) { return a + b }'
  const bG1 = extractByBraces(bS1, 'bF1')
  cases.push({ name: '边界帧① 参数解构 { } 不算函数体（本轮 58 字符就闭合那颗）', ok: bG1 === bS1, got: bG1 ? '长=' + bG1.length : '(null)' })
  const bS2 = 'function bF2({ a }) { if (a) { return 1 } for (const x of a) { } return 0 }'
  const bG2 = extractByBraces(bS2, 'bF2')
  cases.push({ name: '边界帧② 体内嵌 if/for/块 → 真闭合才收', ok: bG2 === bS2, got: bG2 ? '尾=' + JSON.stringify(bG2.slice(-1)) + ' 长=' + bG2.length : '(null)' })
  function bF3Arrow({ a }) { return a }
  const bE3 = judgeExtraction('const bF3Arrow = ({ a }) => a', [['bF3Arrow', bF3Arrow]])
  cases.push({ name: '边界帧③ 箭头定义取不到 → 必报提取失败，不许静默', ok: bE3.ok === false && /提取失败/.test(bE3.bad[0] ?? ''), got: bE3.bad.join('/').slice(0, 58) || '(未报)' })
  const bS4 = 'function bF4({ a }) { return a }\n}\n'
  const bG4 = extractByBraces(bS4, 'bF4')
  cases.push({ name: '边界帧④ 真闭合后多一个 } → 不多吞', ok: bG4 === 'function bF4({ a }) { return a }', got: JSON.stringify(bG4 ? bG4.slice(-8) : null) })
  const bE5 = judgeExtraction('function bF3Arrow({ a }) { return 999 }', [['bF3Arrow', bF3Arrow]])
  cases.push({ name: '边界帧⑤ 配平与 toString 不一致 → 必红（这是边界错，不许降成待人工确认）', ok: bE5.ok === false && /不一致/.test(bE5.bad[0] ?? ''), got: bE5.bad.join('/').slice(0, 58) || '(未报)' })
  return cases
}

function main() {
  const snapDir = SNAPDIR(LIVE)
  const regPath = path.join(snapDir, 'refetch-log.json')
  if (!fs.existsSync(regPath)) { console.log('[check-archive-rules] refetch-log 不存在：' + regPath); process.exit(1) }
  const log = JSON.parse(fs.readFileSync(regPath, 'utf8'))
  const liveBase = path.join(LIVE, 'scripts', 'ledger-structure.baseline.json')
  const liveSections = fs.existsSync(liveBase) ? JSON.parse(fs.readFileSync(liveBase, 'utf8')).sections : null
  const ledgerText = fs.existsSync(path.join(LIVE, 'docs', 'audits', 'MERGE-LEDGER.md')) ? fs.readFileSync(path.join(LIVE, 'docs', 'audits', 'MERGE-LEDGER.md'), 'utf8') : ''
  const registryTexts = ['infeed-registry.json', 'basis-prefill-two-tiers.json', 'registry-prefill-8.json'].map((f) => { const p = path.join(LIVE, 'docs', 'audits', 'ship-evidence', f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' })
  const refs = collectRefs({ snapDir, ledgerText, registryTexts })
  const r = judgeRArch({ entries: log.entries ?? [], refs, liveSections })
  const tablePath = path.join(LIVE, 'docs', 'audits', 'ship-evidence', 'infeed-registry.json')
  const tableRows = fs.existsSync(tablePath) ? (JSON.parse(fs.readFileSync(tablePath, 'utf8')).rows ?? []) : []
  const hm = judgeHandmadeRows({ tableRows, markEnum: log.触发行标记枚举 })
  const au = judgeAuthority({ entries: log.entries ?? [], authorityFor: log.authorityFor, mtimeChanges: log.mtimeChanges, snapDir, refSources: buildRefSources(log) })
  console.log(`[check-archive-rules] 读取树：${LIVE}${FIXTURE_MODE ? '（fixture 模式：未传 --live，不作判据，exit 恒 0）' : ''}`)
  console.log(`[check-archive-rules] live sections=${liveSections} | ${JSON.stringify(r.统计)}`)
  console.log(`[check-archive-rules] 手工挂行核对：表内指向归档件的行 ${hm.表内归档件行数} 条 | 标记枚举 ${JSON.stringify(log.触发行标记枚举 ?? [])}`)
  for (const b of [...r.bad, ...hm.bad, ...au.bad]) console.log('  X ' + b)
  for (const n of au.notices) console.log('  · ' + n)
  console.log(`[check-archive-rules] ${r.ok && hm.ok && au.ok ? 'OK：R-ARCH-1..9 全部满足，手工挂行与标记形状无违例' : 'FAIL：' + (r.bad.length + hm.bad.length + au.bad.length) + ' 项违反'}`)
  console.log('[check-archive-rules][END]')
  process.exit(FIXTURE_MODE ? 0 : (r.ok && hm.ok && au.ok ? 0 : 1))
}

if (process.argv.includes('--self-test')) {
  const cs = selfTest()
  let pass = 0
  for (const c of cs) { if (c.ok) { pass += 1; continue } console.log(`FAIL ${c.name} → ${c.got}`) }
  /* 判据↔用例绑定：判据一改而用例集未重签 → 必红（防「测试没跟着判据走」再出现） */
  const sig = CASE_SIGNATURE(cs.map((c) => c.name), RULESET_SOURCE_HASH)
  /* 绑定必须同时含「判据版本」与「用例集签名」。只比签名的话，改判据版本不重签照样绿 ——
     本轮阳性实测踩到：把 RULESET_VERSION 改成 MUTATED，绑定仍报「一致」。 */
  /* 边界与函数外（本轮补） */
  const srcText = fs.readFileSync(new URL(import.meta.url), 'utf8')
  const FNS = [['judgeRArch', judgeRArch], ['judgeHandmadeRows', judgeHandmadeRows], ['judgeAuthority', judgeAuthority]]
  const ext = judgeExtraction(srcText, FNS)
  const outL = outsideLogic(srcText, FNS)
  const fullHash = crypto.createHash('sha256').update(srcText).digest('hex')
  const outJudge = judgeOutside({ outsideSig: outL.sig, expectedOutsideSig: EXPECTED_OUTSIDE_SIG })
  const binding = judgeBinding({ version: RULESET_VERSION, expectedVersion: EXPECTED_RULESET_VERSION, names: cs.map((c) => c.name), expectedSig: EXPECTED_CASE_SIG ?? sig, sourceHash: RULESET_SOURCE_HASH, expectedSourceHash: EXPECTED_SOURCE_HASH })
  const attention = outJudge.needHuman ? 1 : 0
  const cleanGreen = binding.ok && ext.ok && attention === 0
  const bound = binding.ok && ext.ok
  console.log(`判据版本=${RULESET_VERSION}（期望 ${EXPECTED_RULESET_VERSION}）| 源码哈希=${RULESET_SOURCE_HASH} | 用例集签名=${sig}（期望 ${EXPECTED_CASE_SIG ?? '(未绑定)'}）| 期望源码哈希=${EXPECTED_SOURCE_HASH ?? '(未绑定)'}`)
  console.log(`分函数哈希（改任意一个 → 总 hash 变）：${Object.entries(SOURCE_PIECES).map(([k, v]) => k + '=' + v).join(' | ')}`)
  console.log(`取源范围：${SOURCE_SCOPE.函数.join(' / ')} | 边界 ${SOURCE_SCOPE.起止边界} | 归一化 ${SOURCE_SCOPE.归一化} | 不覆盖 ${SOURCE_SCOPE.不覆盖}`)
  for (const bx of binding.bad) console.log("  绑定违：" + bx)
  console.log(`全文件 hash=${fullHash.slice(0, 16)} | 函数外有效行=${outL.count} | 函数外签名=${outL.sig}（登记 ${EXPECTED_OUTSIDE_SIG ?? '(未登记)'}）`)
  console.log(`体外过滤口径 ${OUTSIDE_FILTER_RULES.length} 条：${OUTSIDE_FILTER_RULES.join(' / ')}`)
  console.log(`注释分界：体内注释参与哈希（改一个注释字符算判据变）｜体外纯注释被第④类整类去掉（改体外注释不算）`)
  console.log(`attention=${attention}（[需人工确认] 是标不是闸：attention=1 时本行不许读成「干净的绿」）`)
  for (const ex of ext.bad) console.log("  边界违：" + ex)
  if (outJudge.needHuman) console.log("  · [需人工确认] " + outJudge.why)
  console.log(`绑定=${bound ? '一致' : '不一致 → 判据/用例/期望值三者缺一，必红'}`)
  console.log(`self-test ${pass}/${cs.length} 通过`)
  console.log('[check-archive-rules][END] fixture=1')
  process.exit(pass === cs.length && bound ? 0 : 1)
}
if (IS_MAIN) main()
