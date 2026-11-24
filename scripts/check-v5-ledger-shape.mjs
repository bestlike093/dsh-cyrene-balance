#!/usr/bin/env node
/**
 * check-v5-ledger-shape.mjs —— v5 审计总账的常驻结构计数闸。
 *
 * 建闸缘由（2026-11-23 定）：写 §8.7、§8.8 那两次 Edit 都把 `## §9` 标题吞掉了，
 * 第一次靠人记得复查抓回，第二次也是复查抓到 —— 两次说明不能靠「记得查」，
 * 得把结构计数做成常驻闸，每次写账自动跑。与 check-ledger-structure.mjs（管 MERGE-LEDGER）
 * 同源不同本，设计沿用它的 anchors 手法。
 *
 * 同族故障一并照住：整本曾被一次 Edit 复制成 4 份，而「§8.7 出现 1 次」在 4 份副本里同样成立 ——
 * 光数单个标题会漏，所以必须逐节数、数顺序、并查「有没有整行重复标题」。
 *
 * 前置非空断言：空集在故障在场时也能绿，所以被查集合为空一律判 FAIL（无效），不判通过。
 *
 * 用法：node scripts/check-v5-ledger-shape.mjs [--self-test]
 * 退出码：0 = 形状完整；1 = 缺节、重复、乱序或集合为空
 */
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(ROOT, 'docs', 'audits', '2026-11-22-审计总账v5-四大层重开卷-源头裁定与算子定桩.md')
const SELFTEST = process.argv.includes('--self-test')

/** 一级章节必须都在，且各 1 次 */
const TOP = ['§0 现场读数', '§1 三大问题的源头裁定', '§2 输入层脉络', '§3 记忆层与接缝',
  '§4 算法层', '§5 渲染层与设置面', '§6 对 v4.1', '§7 挂账迁移', '§8 幽灵件', '§9 下一步']
/**
 * §8 子块覆盖到哪一节：由 baseline 记末节编号，不写死常量。
 *
 * 建由（2026-11-23 裁定）：原先 SUB_COUNT=8 写死，§8.9 之后只被「升序」和「无重名标题」顺带罩着，
 * 整节被删照样绿；而每次写账去手改常量又是靠记忆 —— 这条闸存在的全部意义就是别靠记忆，
 * 一个要靠人记得改的常量，迟早某次写账后被忘掉，形状跟今天所有静默吞一模一样。
 * 现在末节编号落在 scripts/v5-ledger-shape.baseline.json：新增一节要显式跑 --sync-baseline，
 * 忘了同步会红，末节被删也会红。
 */
const BASELINE = path.join(ROOT, 'scripts', 'v5-ledger-shape.baseline.json')
const SYNC = process.argv.includes('--sync-baseline')

function readBaseline () {
  try {
    const j = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    if (Number.isInteger(j.maxSub) && j.maxSub > 0) return j
  } catch { /* 还没生成过 */ }
  return null
}
/**
 * 内容锚点：防「标题在但正文被换掉」。
 * 一律用整行精确匹配，不用全文子串计数 —— 账本里会讨论这些锚点本身
 * （写判据说明时必然提及），子串计数会把「提及」当成「实例」，2026-11-23 首跑就因此假红：
 * 「本卷只此一份」数到 3 次，其中 2 次是 §8.9 的记述引用。同字不同源，这次是把提及判成在场。
 */
const ANCHORS = [
  { name: '本卷只此一份', re: /^本卷只此一份，后续都写在这里。$/ },
  { name: '判据必须有载体', re: /^11\. \*\*判据必须有载体\*\*/ },
  { name: '证据标记', re: /^证据标记：\*\*〔亲验〕\*\*/ },
]

function shape (text) {
  const base = readBaseline()
  const L = text.replace(/\r\n/g, '\n').split('\n')
  const rows = []
  const push = (name, ok, detail = '') => rows.push({ name, ok, detail })
  const cntHead = (needle, level) => L.filter((l) => l.startsWith(level + ' ' + needle)).length
  const cntAny = (needle) => L.filter((l) => l.includes(needle)).length

  // ---- 前置非空 ----
  const heads = L.filter((l) => /^#{2,3} §/.test(l))
  push('P0·标题集合非空', heads.length > 0, `标题行=${heads.length}`)
  if (heads.length === 0) return { rows, bad: 1 }

  // ---- 一级章节各 1 次 ----
  const nums = [...new Set(heads.filter((l) => l.startsWith('## ')).map((l) => /^## (§\d+)/.exec(l)?.[1]).filter(Boolean))]
  push('P1·一级章节编号集合非空', nums.length > 0, `检出=[${nums.sort().join(',')}]`)
  for (const n of TOP) {
    const key = n.split(' ')[0]
    const c = cntHead(n, '##')
    push(`T·## ${key} 恰好 1 次`, c === 1, `实为 ${c} 次`)
  }

  // ---- 卷首与每份副本头部的锚，各只许 1 次 ----
  push('H1·「## 卷首 ·」恰好 1 次', cntHead('卷首 · 不可变更的铁律（任何人碰这套代码前必须遵守）', '##') === 1,
    `实为 ${cntHead('卷首 · 不可变更的铁律（任何人碰这套代码前必须遵守）', '##')} 次`)
  push('H2·头部日期锚恰好 1 次', cntAny('日期 2026-11-22 19:58') === 1, `实为 ${cntAny('日期 2026-11-22 19:58')} 次`)
  push('H3·「本卷只此一份」整行恰好 1 次', L.filter((l) => /^本卷只此一份，后续都写在这里。$/.test(l.trim())).length === 1,
    `整行实为 ${L.filter((l) => /^本卷只此一份，后续都写在这里。$/.test(l.trim())).length} 次`)

  // ---- §8 子块：各 1 次、总数对、严格升序；覆盖范围听 baseline 的 ----
  const sub = L.filter((l) => /^### §8\.\d+ /.test(l)).map((l) => Number(/^### §8\.(\d+) /.exec(l)[1]))
  push('G0·§8 子块集合非空', sub.length > 0, `个数=${sub.length}`)
  const maxNow = sub.length > 0 ? Math.max(...sub) : 0
  const cover = base === null ? maxNow : base.maxSub
  push('B0·baseline 文件在（不在就先跑 --sync-baseline）', base !== null,
    base === null ? `缺 ${path.relative(ROOT, BASELINE)}；实测末节=§8.${maxNow}` : `记的末节=§8.${base.maxSub}，同步于 ${base.syncedAt ?? '?'}`)
  for (let n = 1; n <= cover; n += 1) {
    const c = sub.filter((x) => x === n).length
    push(`G·### §8.${n} 恰好 1 次`, c === 1, `实为 ${c} 次`)
  }
  const ascending = sub.every((n, i) => i === 0 || sub[i - 1] < n)
  push('G9·§8 子块严格升序', ascending, `顺序=[${sub.join(',')}]`)
  if (base !== null) {
    // 整节被删：末节编号掉下来，这条先红，红因直接指着「少了哪一节」
    push(`B1·末节未倒退（实测 §8.${maxNow} 必须 ≥ baseline §8.${base.maxSub}）`, maxNow >= base.maxSub,
      `实测最大=§8.${maxNow}  baseline=§8.${base.maxSub}`)
    // 新增节忘了同步：也要叫。否则 baseline 长期落后，B1 的地板越压越低，等于自己掏空自己
    push(`B2·baseline 与实测末节一致（新增节须显式跑 --sync-baseline）`, maxNow === base.maxSub,
      maxNow > base.maxSub ? `账里已到 §8.${maxNow}，baseline 还停在 §8.${base.maxSub} —— 忘同步`
        : `实测=§8.${maxNow} baseline=§8.${base.maxSub}`)
  }

  /*
   * ---- N 组：二级标题形制（2026-11-23 补，缺口是当场撞出来的）----
   * 我写 §8.22 那发把标题写成 `## 8.22`（少个 §、层级也错），65 条全绿。
   * 原因是 P0 的 heads 只收 /^#{2,3} §/，跑偏的那行压根进不了被数的那一叠，
   * T 组又只比对 §0..§9 十个具名标题——具名清单外的 ## 行落在所有计数的盲区里。
   * 判据打在「每个 ## 行都得合形制」，不靠具名清单穷举，新章名忘了登记也照得到。
   */
  const allH2 = L.map((l, i) => ({ l, n: i + 1 })).filter((x) => /^## /.test(x.l))
  push('N0·二级标题集合非空（空说明解析不到，N1 全为假绿）', allH2.length > 0, `${allH2.length} 个`)
  const badH2 = allH2.filter((x) => !/^## §\d+ /.test(x.l) && !/^## 卷首 · /.test(x.l))
  push('N1·每个 ## 二级标题都合形制（## §N 或卷首）', badH2.length === 0,
    badH2.length ? badH2.slice(0, 4).map((x) => `:${x.n}「${x.l.slice(0, 34)}」`).join(' / ') : `${allH2.length} 个全合`)
  // 曾想再加一条「### §N 开头必须 §N.M」。实测当场误伤 §1 里的「### §1-A、…」这类带字母后缀的合法小节。
  // 跑偏的形状是 ## 缺 §，N 组就守到二级为止，不为了多一层去换一批假红。

  /*
   * ---- O 组：全局序（2026-11-23 补）----
   * G9 只校 §8 子块**区间内**的相对序，所以把某一节整行挪到 ## §9 之后，
   * 序列看着还是升的，B1/B2 也照旧绿——局部序绿、全局序没人看，跟 SUB_COUNT 写死那次同一处残留。
   * 这里补两条：一级章节全局升序；每个 ### §N.M 必须落在自己那章 ## §N 的区间里。
   */
  const topSeq = []
  L.forEach((l, i) => { const m = /^## §(\d+) /.exec(l); if (m) topSeq.push({ n: Number(m[1]), line: i + 1 }) })
  const topAsc = topSeq.every((x, k) => k === 0 || topSeq[k - 1].n < x.n)
  push('O1·一级章节全局严格升序', topAsc && topSeq.length > 0, `序列=[${topSeq.map((x) => '§' + x.n).join(',')}]`)
  let curTop = -1
  const outOfSection = []
  L.forEach((l, i) => {
    const t = /^## §(\d+) /.exec(l)
    if (t) { curTop = Number(t[1]); return }
    const s = /^### §(\d+)\.(\d+) /.exec(l)
    if (s && Number(s[1]) !== curTop) outOfSection.push({ ch: s[1], sub: s[2], line: i + 1, cur: curTop })
  })
  push('O2·每个 ### §N.M 落在本章 ## §N 区间内', outOfSection.length === 0,
    outOfSection.length ? outOfSection.slice(0, 4).map((x) => `§${x.ch}.${x.sub} 出现在 :${x.line}，此刻所在章=§${x.cur}`).join(' / ')
      : '所有子块都在自己章内')

  // ---- 整行重复标题：4 倍副本那类故障的直接形状 ----
  const seen = new Map()
  for (const h of heads) seen.set(h, (seen.get(h) ?? 0) + 1)
  const dup = [...seen.entries()].filter(([, v]) => v > 1)
  push('D·无整行重复标题', dup.length === 0,
    dup.length ? dup.slice(0, 3).map(([k, v]) => `x${v} ${k.slice(0, 24)}`).join(' / ') : '')

  // ---- 内容锚点：标题在、正文被整段换掉也要抓到 ----
  for (const a of ANCHORS) {
    const n = L.filter((l) => a.re.test(l.trim())).length
    push(`A·锚点「${a.name}」整行存在`, n >= 1, `整行命中 ${n} 次`)
  }

  // ---- V 组：边界行不许用模糊量词代替文件清单 ----
  // 建由：分类那步要靠「本轮动了哪些文件」，而账里写过「renderer 下 4 文件」这种话——
  // 机器只能提出 0 个文件名，人就得回去猜，跟今天所有「口径太粗」同族。


  // 边界行有两种写法：`边界：` 与 `**边界**：`。2026-11-23 用注入样本试出粗体那种 V 组压根看不见
  // （全文实有 2 条），只认一种等于只数自己写得下的那部分，跟「空集假绿」同族，所以两种都收。
  const bounds = []
  let curSec = ''
  L.forEach((l, i) => {
    const h = /^### §8\.(\d+) 【/.exec(l)
    if (h) { curSec = h[1]; return }
    if (/^## §\d+ /.test(l)) { curSec = '' }
    if (/^(?:\*\*)?边界/.test(l) && curSec !== '') bounds.push({ sec: curSec, line: i + 1, text: l })
  })
  /*
   * B3·边界行的向前棘轮（2026-11-23 定）：只拦新写的节，不翻旧账。
   * §8 现有各节里若干节当年真没写边界行，要求「每节必须有」会当场红一片——那是拿判据逼一次
   * 大规模补账，跟「为让灯全绿顺手改一大片」同病。豁免线落在 baseline.boundaryExemptMax：
   * 编号大于它的节必须写边界行，旧账走独立一格、补一节验一节。
   * sync 只在字段缺失时按当次末节写一次，之后不许抬高，否则棘轮自己掏空自己。
   */
  // fallback 取已签的 maxSub，取不到才退实测末节：旧写法用 maxNow，字段没落地那一轮会把刚加的
  // 新节一并豁免掉——注入 §8.25 无边界行那发就是这么漏过去的（2026-11-23 证红当场抓到）。
  const exempt = base ? (Number.isInteger(base.boundaryExemptMax) ? base.boundaryExemptMax : base.maxSub) : maxNow
  const haveBound = new Set(bounds.map((b) => Number(b.sec)))
  const noBound = [...new Set(sub)].filter((n) => n > exempt && !haveBound.has(n))
  push(`B3·编号 > ${exempt} 的 §8 节必须写边界行（旧节豁免，另格补账）`,
    noBound.length === 0,
    noBound.length ? `缺边界行：${noBound.map((n) => '§8.' + n).join(', ')}` : `豁免线 §8.${exempt}，其上各节都有`)
  push('V0·§8 各节边界行集合非空（空说明写账没记边界，下面全为假绿）', bounds.length > 0, `条数=${bounds.length}`)
  for (const b of bounds) {
    // 量词只认「N 文件 / N 个文件 / 一批 / 若干 / 数个」这类描述本轮改动面的话。
    // 首版把「件|处」也收进来，结果 §8.18 边界行里「B 类 71 处」这种外部计数被误判——
    // 那是别人欠的账数，不是「我动了 71 个文件」的声明。覆盖范围写错改判据，与 K 组特例化同理。
    // 量词分两类，各判各的：
    //  「N 个文件」给了数 —— 就得真列出 N 个，列不够算红；
    //  「一批/若干/数个」没给数 —— 含糊词本身就不许用同行别处的文件名抵数，出现即红。
    // 起因（2026-11-23）：自测样本「粗体边界行说一批态」MISSED，旧判据把 need 算成 1，
    // 而那条边界行里本来就有好几个反引号文件名，一句「一批文件」混在真清单里照样绿。
    const counted = /(\d+)\s*(?:个)?文件/.exec(b.text)
    const handWave = /一批|若干|数个/.exec(b.text)
    const named = (b.text.match(/`[^`]*\.(?:mjs|js|json|md|html|css|cjs|yml|txt)`/g) ?? []).length
    const okVague = handWave === null && (counted === null || named >= Number(counted[1]))
    push(`V·§8.${b.sec} 边界行 :${b.line} 没用模糊量词代替清单`,
      okVague,
      handWave !== null ? `出现含糊词「${handWave[0]}」，改动面必须具名，同行列了 ${named} 个也不抵`
        : counted !== null ? `量词「${counted[0].trim()}」要求列出 ≥${Number(counted[1])} 个文件名，实际 ${named} 个` : '')
  }

  // ---- W 组：纳管义务（2026-11-23 定，纳管是持续义务不是一次性 add）----
  // 这些有状态文件承载签核凭据，git clean 抹掉未跟踪面就无声丢失。纳管后每次变更必须重新 git add，
  // 否则被跟踪的那份变成陈旧快照——跟手改 SUB_COUNT 常数同病。这帧把「忘了 add」变成红。
  const STATE_FILES = [
    'scripts/v5-ledger-shape.baseline.json',
    'scripts/ledger-structure.baseline.json',
    'scripts/scan-plugin-chain.exceptions.json',
    'scripts/schema-fork.baseline.json',
    // v5 总账正本入列（2026-11-24 §8.51 补漏）：前四轮落账脚本漏 add 账本无人咬，
    // 「落账与跟手」义务必须覆盖账本自身。
    'docs/audits/2026-11-22-审计总账v5-四大层重开卷-源头裁定与算子定桩.md',
  ]
  push(`W0·${STATE_FILES.length} 个状态文件都在磁盘`, STATE_FILES.every((f) => fs.existsSync(path.join(ROOT, f))),
    STATE_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f))).join(', ') || `${STATE_FILES.length}/${STATE_FILES.length}`)
  const gst = spawnSync('git', ['status', '--porcelain', '--', ...STATE_FILES], { cwd: ROOT, encoding: 'utf8' })
  if (gst.status !== 0 || gst.error) {
    push('W1·git 可用（不可用则纳管态无从核对，不静默绿）', false, String(gst.error ?? gst.stderr ?? '').slice(0, 80))
  } else {
    const lines = gst.stdout.replace(/\r/g, '').split('\n').filter((l) => l.trim())
    const seen = new Set()
    for (const l of lines) {
      const xy = l.slice(0, 2)
      const f = l.slice(3).trim()
      seen.add(f)
      if (xy === '??') push(`W·${f} 已纳管`, false, '仍是未跟踪（??），git clean 一下就没——先 git add')
      else if (xy[1] !== ' ') push(`W·${f} 变更已进 index`, false, `worktree≠index（${xy}）——变了没 add，纳管义务未履行`)
      else push(`W·${f} 已纳管且 index 是当前态`, true, xy)
    }
    for (const f of STATE_FILES) {
      if (!seen.has(f)) push(`W·${f} 已纳管且与 HEAD 一致`, fs.existsSync(path.join(ROOT, f)), 'porcelain 无输出=干净')
    }
  }

  /*
   * W2·显式豁免：scan-plugin-chain.mjs 必须保持「未跟踪」。
   * 它是安全检测器，RULES 表、KNOWN_FAKE、自检阳性样本里就带着它要抓的那些字面量——
   * 这是这个文件的属性，不是待修缺陷：检测器的源码不可能同时满足「它检测的东西绝不出现在源码里」。
   * 2026-11-23 裁定走 disk-only（不纳管、可重建、不发布），否掉码点拼接（那等于把
   * 「这样编码就能过红线」的可运行范例签核进版本面），也否掉给红线闸开例外白名单。
   * 但豁免必须是钉住的，不是静默盲区：它一旦被误 git add，这帧就红。
   */
  const DISK_ONLY = ['scripts/scan-plugin-chain.mjs']
  for (const f of DISK_ONLY) {
    const trackedNow = spawnSync('git', ['ls-files', '--', f], { cwd: ROOT, encoding: 'utf8' }).stdout.replace(/\r/g, '').trim() !== ''
    const stagedNow = spawnSync('git', ['diff', '--cached', '--name-only', '--', f], { cwd: ROOT, encoding: 'utf8' }).stdout.replace(/\r/g, '').trim() !== ''
    push(`W2·${f} 保持未纳管（显式豁免）`, !trackedNow && !stagedNow,
      trackedNow ? '已回到跟踪面——要么按裁定 git rm --cached 撤出，要么改裁定并回写本节说明' : stagedNow ? '又被 git add 进 index 了，豁免被破' : 'disk-only ✓')
  }

  /*
   * W3·未跟踪脚本棘轮：只降不升。
   * 裁定的口径是「除这一个之外其余 scripts 仍须纳管」，但 scripts/ 家底是 78 个 .mjs、
   * 未跟踪 59 个，其中 20 个还是 check 链真在跑的——一次性把 59 个判红等于替这轮扩了授权范围。
   * 所以这里先钉住现状不恶化（计数超过基线就红），把「要不要全量纳管」留成明确待裁的一格，
   * 而不是让 W 帧用一片红去替谁做决定。基线变动必须同时改这个数并回写账本。
   */
  const UNTRACKED_CEILING = 59
  const mjsAll = fs.existsSync(path.join(ROOT, 'scripts'))
    ? fs.readdirSync(path.join(ROOT, 'scripts')).filter((x) => x.endsWith('.mjs') && !/^tmp-/.test(x))
    : []
  const trackedSet = new Set(spawnSync('git', ['ls-files', '--', 'scripts'], { cwd: ROOT, encoding: 'utf8' }).stdout.replace(/\r/g, '').split('\n').filter(Boolean).map((p) => p.replace(/^scripts\//, '')))
  const stagedSet = new Set(spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=A', '--', 'scripts'], { cwd: ROOT, encoding: 'utf8' }).stdout.replace(/\r/g, '').split('\n').filter(Boolean).map((p) => p.replace(/^scripts\//, '')))
  const untrackedNow = mjsAll.filter((x) => !trackedSet.has(x) && !stagedSet.has(x))
  push(`W3·未跟踪 scripts/*.mjs 不超过基线 ${UNTRACKED_CEILING}`, untrackedNow.length <= UNTRACKED_CEILING,
    untrackedNow.length <= UNTRACKED_CEILING
      ? `实测 ${untrackedNow.length}（含 W2 豁免 1 个）`
      : `实测 ${untrackedNow.length} 超基线——要么 git add 纳管它，要么改基线并回写账本：${untrackedNow.slice(0, 12).join(', ')}${untrackedNow.length > 12 ? ` …共 ${untrackedNow.length} 个` : ''}`)

  return { rows, bad: rows.filter((r) => r.ok !== true).length }
}

const text = fs.readFileSync(LEDGER, 'utf8')

// 显式同步：把 baseline 的末节编号对齐到账本当前实际末节。写完新节跑一次；不跑，B2 会红。
if (SYNC) {
  const nums = text.replace(/\r\n/g, '\n').split('\n')
    .filter((l) => /^### §8\.\d+ /.test(l)).map((l) => Number(/^### §8\.(\d+) /.exec(l)[1]))
  if (nums.length === 0) { console.log('[sync] 一个 §8 子块都没解析到，拒绝写空 baseline'); process.exit(1) }
  const maxSub = Math.max(...nums)
  const old = readBaseline()
  fs.writeFileSync(BASELINE, JSON.stringify({
    maxSub,
    subCount: new Set(nums).size,
    boundaryExemptMax: old && Number.isInteger(old.boundaryExemptMax) ? old.boundaryExemptMax : maxSub,
    syncedAt: new Date().toISOString(),
    note: 'v5 总账结构闸的末节基线。写完新节跑 node scripts/check-v5-ledger-shape.mjs --sync-baseline 更新；不更新 B2 红。',
  }, null, 2) + '\n', 'utf8')
  console.log(`[sync] baseline ${old ? '§8.' + old.maxSub : '（原先不存在）'} → §8.${maxSub}，已写 ${path.relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (SELFTEST) {
  const baseNow = readBaseline()
  const lastSub = baseNow ? baseNow.maxSub : 0
  // 把某一节整节切掉：含标题行与正文，止于下一个 ### 或 ## 之前
  const cutSection = (t, n) => {
    const lines = t.replace(/\r\n/g, '\n').split('\n')
    const i = lines.findIndex((l) => l.startsWith(`### §8.${n} `))
    if (i < 0) return t
    let j = i + 1
    while (j < lines.length && !/^### /.test(lines[j]) && !/^## /.test(lines[j])) j += 1
    return lines.slice(0, i).concat(lines.slice(j)).join('\n')
  }
  const cases = [
    ['副本态（把 §0 那节再接一遍）', text + '\n' + text.slice(text.indexOf('## §0 现场读数'), text.indexOf('## §1 '))],
    ['吞标题态（删掉 ## §9 那行）', text.replace(/^## §9 [^\n]*/m, '')],
    ['乱序态（§8.1 与 §8.7 对调）', text.replace(/^### §8\.7 /m, '### §8.99TMP ').replace(/^### §8\.1 /m, '### §8.7 ').replace(/^### §8\.99TMP /m, '### §8.1 ')],
    /*
     * 锚点态必须用整行正则造样本。早先用非全局子串 replace(/本卷只此一份，后续都写在这里。/)，
     * 只换第一处命中——账本前面有地方提及这句（写判据说明时难免引用），第一处落到提及上，
     * 真锚行没动，判据不红，自测报成 MISSED。这是样本自己没生效，别当成判据失效。
     */
    ['锚点替换态（把「本卷只此一份」那一整行换成等长别话）',
      text.replace(/^本卷只此一份，后续都写在这里。$/m, '本卷共有两份，后续写在别处。')],
    /*
     * 2026-11-23 补的三种：全是当天真实撞出来、旧闸放过的形状。
     * 只加断言不加样本，下次仍是「不靠记忆才抓不到」——语料里没这几个形状，自测 6/6 也照样漏。
     */
    ['跑偏二级标题态（插一行 ## 8.99，缺 §）', text.replace(/^## §9 /m, '## 8.99 【自测造的跑偏标题】\n\n自测样本，不落盘。\n\n## §9 ')],
    ['子块越界态（把末节 ### §8.x 整行挪到 ## §9 之后）', (() => {
      const t = text
      const nums = [...t.matchAll(/^### §8\.(\d+) /gm)].map((m) => Number(m[1]))
      if (nums.length === 0) return t
      const last = Math.max(...nums)
      const i = t.indexOf(`### §8.${last} `)
      if (i < 0) return t
      const j = t.indexOf('\n', i)
      const line = t.slice(i, j)
      const rest = t.slice(0, i) + t.slice(j + 1)
      const k = rest.search(/^## §9 /m)
      if (k < 0) return t
      const e = rest.indexOf('\n', k)
      return rest.slice(0, e + 1) + '\n' + line + '\n' + rest.slice(e + 1)
    })()],
    ['粗体边界行说一批态（把 **边界** 行里的一个文件名换成「一批文件」）',
      text.replace(/^(\*\*边界\*\*：[^\n]*)/m, (m) => m.replace(/`scripts\/[a-z-]+\.mjs`/, '一批文件'))],

  ]
  if (lastSub > 0) {
    cases.push([`整节被删态（末节 §8.${lastSub} 连标题带正文整节切掉）`, cutSection(text, lastSub)])
    cases.push([`忘同步态（账里多了 §8.${lastSub + 1}，baseline 还停在 §8.${lastSub}）`,
      text.replace(/^## §9 /m, `### §8.${lastSub + 1} 【自测造的未登记新节】\n\n自测样本，不落盘。\n\n## §9 `)])
  cases.push(['无边界行新节态（新节有标题、正文就是不写边界行）', text.replace(/^## §9 /m, `### §8.${lastSub + 2} 【自测造的无边界行新节】\n\n正文不写边界行。\n\n## §9 `)])
  } else {
    console.log('[self-test] 没有 baseline，跳过两条 baseline 专属样本（此时 B0 应当正红）')
  }
  let alive = 0
  let invalid = 0
  for (const [name, broken] of cases) {
    // 样本自证：没改动任何字节的样本是无效样本，既不算抓到也不算漏，单独报出来。
    // 少了这道闸，一个写坏的正则会让自测永远显示「抓到/没抓到」，而其实什么都没发生。
    if (broken === text) {
      invalid += 1
      console.log('[BAD-SAMPLE] ' + name + '  样本没改动任何字节，判据无从表现')
      continue
    }
    const r = shape(broken)
    if (r.bad > 0) alive += 1
    console.log((r.bad > 0 ? '[CAUGHT] ' : '[MISSED] ') + name + '  判红 ' + r.bad + ' 条')
    r.rows.filter((x) => x.ok !== true).slice(0, 3).forEach((x) => console.log('         ' + x.name + ' → ' + x.detail))
  }
  const pass = alive === cases.length && invalid === 0
  console.log('\n自测：' + (pass ? `${cases.length}/${cases.length} 种损坏全部抓到，闸是活的`
    : `抓到 ${alive}/${cases.length}，无效样本 ${invalid} —— 闸或样本不成立`))
  process.exit(pass ? 0 : 1)
}

const { rows, bad } = shape(text)
console.log('[check-v5-ledger-shape] ' + path.basename(LEDGER))
rows.forEach((r) => console.log((r.ok === true ? '  OK  ' : '  RED ') + r.name + (r.detail ? '  → ' + r.detail : '')))
console.log(`[check-v5-ledger-shape] 共 ${rows.length} 条，红 ${bad} 条`)
process.exit(bad === 0 ? 0 : 1)
