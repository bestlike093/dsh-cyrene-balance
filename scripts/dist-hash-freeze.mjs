/**
 * 产物 hash 冻结（S0-3 前置动作 3）。
 *
 * **管辖面（必须先读这一段，别以为全仓有护栏）**：
 * 冻结范围只有三处 —— 手改外壳（`pet/standalone/apps/desktop/electron/**`）、
 * 编译产物（`apps/desktop/dist/**` 与 `pet/standalone/packages/**`）、根目录九件。
 * 本质上是「会被上游构建覆盖的那一层」。
 * **`lib/` 业务源码自 §8.71 纳入冻面**（主人拍板二：扩基线，不取「明确接受不冻」）：
 * 冻的是「未登记变更」语义对 lib 同样成立——改 lib 走 adjudication 窗口登记，
 * 验证全绿后 --write 重冻；未登记即入暂存，本闸红。P1/3.x 大量改 lib，
 * 回滚的对象必须先被冻住过，宪法「可回滚」才不是空话。
 *
 * 语义（照主人 02:01 的钉，必须写在代码里免得下一个人理解成"产物不许变"）：
 * **冻的是「未登记变更」，不是「产物不许变」。**
 * 三处断点一修，main.mjs / windowShell.js / renderer.mjs 的 hash 必然变；
 * 如果基线没有预登记变更窗口，check 立刻红，人就会习惯性绕过去 ——
 * 与裁判「长期挂红被绕过」是同一个坑。
 *
 * 所以变更是否放行，唯一依据是 MERGE-LEDGER 里那段 <!-- adjudication --> 的 exceptions。
 * 与 tree-inventory 共用 `scripts/lib/adjudication.mjs`，不写第二套。
 * 例外分两类：产物类逐件登记（改哪个文件写哪条）；配置类（package.json 这类
 * 会频繁微调的）给一条 `pet/standalone/apps/desktop/**` 之外的短周期整目录例外，
 * 避免例外清单在批量接线时爆掉。
 *
 * 顺带把活树根目录九件的 hash 一起登记：名字对得上只能证明没丢文件，
 * 证明不了没丢内容（S0-3 的 main.mjs 225KB vs 336KB 就是这么来的）。
 *
 * 用法：
 *   node scripts/dist-hash-freeze.mjs --write   # 刷新基线（签核后回写新基线）
 *   node scripts/dist-hash-freeze.mjs           # 校验（进 npm run check）
 * 退出码：0 = 无未登记变更；1 = 有未登记变更；3 = 裁定已过期（blocked）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { LEDGER_RELATIVE, readAdjudicationFrom, exceptionFor, adjudicationState } from './lib/adjudication.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.join(HERE, '..')
export const BASELINE_FILE = path.join(HERE, 'dist-hash-freeze.json')

/** 参与冻结的范围：手改外壳 + 编译产物 + 根目录九件 + lib/ 业务源码（§8.71 拍板扩基线：
 *  HEAD 永久不裁+未提交说明 git 回滚路本就不通，lib/ 不冻=没有回滚对象；
 *  流程代价=改 lib 前先过 adjudication 登记窗口、改完验证全绿再 --write 重冻入账）。 */
const SCAN_ROOTS = [
  'lib',
  path.join('pet', 'standalone', 'apps', 'desktop', 'electron'),
  path.join('pet', 'standalone', 'apps', 'desktop', 'dist'),
  path.join('pet', 'standalone', 'packages'),
]
const ROOT_FILES = [
  '.gitignore',
  'LICENSE',
  'README.md',
  'cordis.patch.yml',
  'edition.json',
  'index.cjs',
  'manifest.json',
  'package.json',
  'package-lock.json',
]
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.venv', '__pycache__', 'assets', 'models'])
const SKIP_EXT = new Set(['.map', '.log', '.tmp'])

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (!SKIP_EXT.has(path.extname(e.name).toLowerCase())) yield p
  }
}

/** 收集当前所有受冻文件：相对路径 → sha256。 */
export function collectFrozen(root = ROOT) {
  const map = new Map()
  for (const rel of ROOT_FILES) {
    const abs = path.join(root, rel)
    if (fs.existsSync(abs)) map.set(rel.replace(/\\/g, '/'), sha256File(abs))
  }
  for (const relRoot of SCAN_ROOTS) {
    for (const abs of walk(path.join(root, relRoot))) {
      map.set(path.relative(root, abs).replace(/\\/g, '/'), sha256File(abs))
    }
  }
  return map
}

/**
 * 发布面 parity：files 白名单的每一项都必须被冻结面覆盖。
 *
 * 起因：SCAN_ROOTS 是手写清单，files 是另一份，两份不重合。
 * `lib/`（主运行时）和 `assets/` 长期不在冻结面里，改动不受护栏。
 * 只补一行 lib 治不了根——下次加目录又漏。
 */
function checkFilesParity() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const entries = (pkg.files ?? []).filter((e) => !String(e).startsWith('!'))
  const covered = [...SCAN_ROOTS, ...ROOT_FILES].map((p) => p.replace(/\\/g, '/'))
  const issues = []

  for (const raw of entries) {
    const entry = String(raw).replace(/\\/g, '/')
    if (covered.includes(entry)) {
      issues.push({ entry, state: '覆盖' })
      continue
    }

    const abs = path.join(ROOT, entry)
    const isDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory()
    if (!isDir) {
      issues.push({ entry, state: '未覆盖' })
      continue
    }

    // 目录项：看它的一级子项里有那些没被任何 SCAN_ROOTS 子树覆盖
    const under = covered.filter((c) => c.startsWith(`${entry}/`))
    if (under.length === 0) {
      issues.push({ entry, state: '整棵未覆盖' })
      continue
    }
    const coveredTop = new Set(under.map((c) => c.slice(entry.length + 1).split('/')[0]))
    const actualTop = fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => !SKIP_DIRS.has(e.name))
      .map((e) => e.name)
    const missing = actualTop.filter((n) => !coveredTop.has(n))
    if (missing.length > 0) {
      issues.push({ entry, state: `部分覆盖，缺 ${missing.length} 项`, detail: missing })
    } else {
      issues.push({ entry, state: '覆盖（子树）' })
    }
  }

  return issues
}

/**
 * --expand：按 files 白名单跑一遍冻结面，输出「如果扩面会有多少待裁项」。
 * 只读，不写基线、不改期望值。
 */
function expandReport() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const entries = (pkg.files ?? []).filter((e) => !String(e).startsWith('!')).map((e) => String(e).replace(/\\/g, '/'))
  const excluded = (pkg.files ?? []).filter((e) => String(e).startsWith('!')).map((e) => String(e).replace(/^!/, '').replace(/\\/g, '/'))

  const isExcluded = (rel) =>
    excluded.some((pat) => {
      const p = pat.replace(/\*\*/g, '').replace(/^\//, '')
      return rel.includes(p.replace(/\/$/, ''))
    })

  const map = new Map()
  const walkAll = (absDir, relDir) => {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const abs = path.join(absDir, e.name)
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (isExcluded(rel)) continue
      if (e.isDirectory()) walkAll(abs, rel)
      else if (!SKIP_EXT.has(path.extname(e.name).toLowerCase())) map.set(rel, sha256File(abs))
    }
  }

  for (const entry of entries) {
    const abs = path.join(ROOT, entry)
    if (!fs.existsSync(abs)) continue
    if (fs.statSync(abs).isDirectory()) walkAll(abs, entry)
    else map.set(entry, sha256File(abs))
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  const art = baseline.artifacts ?? {}
  const missing = [...map.keys()].filter((k) => !(k in art))
  const changed = [...map.keys()].filter((k) => k in art && art[k] !== map.get(k))
  const removed = Object.keys(art).filter((k) => !map.has(k))

  const byRoot = {}
  for (const k of missing) {
    const root = k.split('/')[0]
    byRoot[root] = (byRoot[root] ?? 0) + 1
  }

  console.log('=== 扩面预演（只读，不写基线）===')
  console.log('files 项:', entries.join(' / '))
  console.log('冻结集合将从', Object.keys(art).length, '条变为', map.size, '条')
  console.log('未入基线:', missing.length)
  for (const [r, n] of Object.entries(byRoot).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${r}: ${n}`)
  }
  console.log('已入基线但内容变了:', changed.length)
  console.log('基线有但发布面没有:', removed.length)
  console.log('')
  console.log('前 15 条未入基线：')
  for (const k of missing.slice(0, 15)) console.log('   ', k)
  process.exit(1)
}

function reportParity(table) {
  const issues = table.filter((r) => r.state !== '覆盖' && r.state !== '覆盖（子树）')
  console.log('[dist-hash-freeze] 发布面逐项（files 全量，含已覆盖项）：')
  for (const r of table) {
    const detail = r.detail ? `  → ${r.detail.slice(0, 12).join(' / ')}` : ''
    console.log(`   [${r.state}] ${r.entry}${detail}`)
  }
  return issues
}


/**
 * @returns {{changed:Array, added:Array, removed:Array, allowed:Array, blocked:boolean, reason?:string}}
 */
export function diffFrozen(baseline, current, adjudication, now = new Date()) {
  const changed = []
  const added = []
  const removed = []
  const allowed = []

  const judge = (filePath, kind) => {
    const ex = exceptionFor(adjudication, filePath, now)
    if (ex === null) {
      if (kind === 'changed') changed.push(filePath)
      else if (kind === 'added') added.push(filePath)
      else removed.push(filePath)
    } else {
      allowed.push({ path: filePath, kind, authority: ex.authority, until: ex.until })
    }
  }

  for (const [filePath, hash] of current) {
    if (!(filePath in baseline.artifacts)) judge(filePath, 'added')
    else if (baseline.artifacts[filePath] !== hash) judge(filePath, 'changed')
  }
  for (const filePath of Object.keys(baseline.artifacts)) {
    if (!current.has(filePath)) judge(filePath, 'removed')
  }

  // 过期态自己算一遍：调用方可能传的是 parse 结果（没有 state 字段），
  // 也可能传的是 readAdjudicationFrom 的结果（有 state）。两种都要认得。
  const state = adjudicationState(adjudication, now)
  const blocked = state.state === 'blocked'
  return { changed, added, removed, allowed, blocked, reason: state.reason }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const write = process.argv.includes('--write')
  if (process.argv.includes('--expand')) expandReport()

  /*
   * parity 单独一步退出。**不能在这里 exit**：否则范围缺口会盖住 5 件未裁的红，
   * 两个红挤在同一步，看见的那个把没看见的那个藏起来。
   */
  const parityIssues = reportParity(checkFilesParity())
  if (process.argv.includes('--parity')) {
    if (parityIssues.length === 0) {
      console.log('[dist-hash-freeze] parity OK：files 每一项都被冻结面覆盖')
      process.exit(0)
    }
    console.error(`[dist-hash-freeze] FAIL：${parityIssues.length} 项未被冻结面覆盖`)
    console.error('这是范围缺口，不是回归。只补一棵了事禁止：下次加目录又漏。')
    process.exit(1)
  }
  if (parityIssues.length > 0) {
    console.error(`[dist-hash-freeze] 提示：另有 ${parityIssues.length} 项覆盖缺口（见 --parity）`)
  }

  const current = collectFrozen()

  if (write) {
    /*
     * 重冻只消「基线滞后」，不能顺手把待裁项登记成合规。
     * 排除清单来自 union-pending 产出的 pending-refreeze.json：
     * 旧基线里有的保留旧 hash，没有的不写入 —— 它们继续红着等闸。
     */
    const HOLD = path.join(ROOT, 'docs', 'audits', 'ship-evidence', 'pending-refreeze.json')
    const old = fs.existsSync(BASELINE_FILE)
      ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).artifacts ?? {}
      : {}
    let held = []
    if (!process.argv.includes('--allow-pending')) {
      if (!fs.existsSync(HOLD)) {
        console.error('[dist-hash-freeze] --write 缺待裁排除清单，拒绝写入。')
        console.error('  先跑 node scripts/union-pending.mjs 生成；确认无待裁项才允许 --allow-pending。')
        process.exit(1)
      }
      held = JSON.parse(fs.readFileSync(HOLD, 'utf8'))['重冻排除清单'] ?? []
    }

    const next = new Map(current)
    for (const p of held) {
      if (p in old) next.set(p, old[p])
      else next.delete(p)
    }
    if (held.length > 0) {
      console.log(`[dist-hash-freeze] 重冻保留待裁项 ${held.length} 个，它们继续红着等闸`)
      for (const p of held) console.log(`   [保留] ${p}`)
    }

    const artifacts = Object.fromEntries([...next].sort(([a], [b]) => a.localeCompare(b)))
    const libCount = [...next.keys()].filter((k) => k.startsWith('lib/')).length
    const payload = {
      generatedAt: new Date().toISOString(),
      note: '冻未登记变更，不冻「产物不许变」；变更放行依据 MERGE-LEDGER 的 adjudication.exceptions',
      scope: libCount === 0 ? 'legacy-pet-only' : 'publish-files',
      scopeNote: `派生自活树：lib 条目数=${libCount}，非手填`,
      count: next.size,
      heldPending: held,
      artifacts,
    }
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    console.log(`基线已刷新：${next.size} 个文件（排除待裁 ${held.length} 个）`)
    process.exit(0)
  }

  /*
   * 基线缺失一律红，并且**禁止改成自动重建**。
   * 危险路径：clean checkout 里读不到基线 → 拿当前树当初始值 → 1/25 红静默变 0/25 绿，
   * 而改动根本没裁过。和「文件 0 上的 PASS」同族。
   */
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error('[dist-hash-freeze] 基线缺失：禁止自动重建。')
    console.error('  更新基线只能在明确的迁移动作里做：带 git log 引用 + 逐条 diff 理由 + 新 hash。')
    process.exit(1)
  }

  let baseline
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  } catch (e) {
    console.error(`[dist-hash-freeze] 基线损坏，禁止自动重建：${String(e.message ?? e)}`)
    process.exit(1)
  }

  const artifactCount = Object.keys(baseline.artifacts ?? {}).length
  if (!baseline.artifacts || artifactCount === 0 || artifactCount !== baseline.count) {
    console.error(
      `[dist-hash-freeze] 基线结构不对：count=${baseline.count} 实际=${artifactCount}，禁止自动重建。`,
    )
    process.exit(1)
  }

  /*
   * 覆盖率断言：发布面每个文件都必须已经在基线条目里。
   * count === artifacts 只验基线内部自洽；这一条验基线对发布面的覆盖。
   * 否则「没报」可能只是「根本没进基线」，等于「文件 0 上的 PASS」换个入口。
   */
  const unlisted = [...current.keys()].filter((p) => !(p in baseline.artifacts))
  if (unlisted.length > 0) {
    console.error(`[dist-hash-freeze] 有 ${unlisted.length} 个发布面文件不在基线里（从未被冻过）：`)
    for (const p of unlisted.slice(0, 12)) console.error(`   [未入基线] ${p}`)
    if (unlisted.length > 12) console.error(`   …… 另有 ${unlisted.length - 12} 个`)
    console.error('先按迁移动作补进基线，再谈 changed / added。')
    process.exit(1)
  }

  const adj = readAdjudicationFrom(fs, path, path.join(ROOT, LEDGER_RELATIVE))
  const result = diffFrozen(baseline, current, adj)
  const pending = result.changed.length + result.added.length + result.removed.length

  if (result.allowed.length > 0) {
    console.log(`已登记变更 ${result.allowed.length} 处：`)
    for (const a of result.allowed.slice(0, 12)) console.log(`   [${a.kind}] ${a.path}　← ${a.authority}（至 ${a.until}）`)
    if (result.allowed.length > 12) console.log(`   …… 另有 ${result.allowed.length - 12} 处`)
  }

  if (pending === 0) {
    console.log(`产物冻结通过：${current.size} 个文件与基线一致${result.allowed.length > 0 ? '（含已登记变更）' : ''}`)
    process.exit(0)
  }

  console.error(`\n未登记变更 ${pending} 处：`)
  for (const p of result.changed.slice(0, 10)) console.error(`   [改] ${p}`)
  for (const p of result.added.slice(0, 10)) console.error(`   [增] ${p}`)
  for (const p of result.removed.slice(0, 10)) console.error(`   [删] ${p}`)
  if (result.blocked) {
    console.error(`\n裁定已过期：${result.reason}`)
    console.error('先完成合流签核并把新基线回写，再继续改产物。')
    process.exit(3)
  }
  console.error('\n如果这是三条裁定授权内的改动，请在 MERGE-LEDGER 的 exceptions 里登记；')
  console.error('如果是签核后的正常推进，跑 --write 回写新基线。')
  process.exit(1)
}
