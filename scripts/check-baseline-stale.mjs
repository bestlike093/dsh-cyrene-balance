/**
 * 账本基线 stale 专尺（审计专用 · 非交付件，未进主树 registry）
 *
 * 为什么要另立一支：活树 check-ledger-structure.mjs 的节数断言只判「减少」
 * （n < baseline.sections），不判「基线落后于账本」。所以账本追加一节却没跑
 * --rerun 时，那把尺照样绿 —— 而 baseline.json 正是它 --rerun 的写回对象，
 * 尺子跑一次就改自己的依据。2026-11-18 实测：同步进副本时 122 节，
 * 账本追加索引节后立刻 123，同步完当场 stale。
 *
 * 读哪个值（写死，二选一，不许两个都算数）：
 *   判据一律读**活树当前值**；副本树里那份只作时点快照，永不作合规值。
 *   所以在副本树上跑本尺也要用 --live 指到活树，两边不同步就报。
 *
 * 重取分离：基线重取（--rerun）属尺子自己；本尺只读不写，
 *   快照留档走 docs/audits/ship-evidence/baseline-snapshots/ + refetch-log.json，
 *   旧对象标 superseded 不删。谁也不替谁消红。
 *
 * 用法：node scripts/check-baseline-stale.mjs [--self-test] [--live <活树根>]
 * 退出码：0 = 基线与账本同步；1 = stale / 缺件
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/* 入口级开关（你点：别只靠输出那句声明）——未传 --live 即 fixture 模式：
   现值只作展示、不作判据，退出码固定 0。判据必须显式 --live 指到活树。 */
const FIXTURE_MODE = process.argv.indexOf('--live') < 0
/* IS_MAIN 守卫：被 import 时不得跑主流程。第三次踩这格（union-pending 之后是 version-registry，
   这次是 rewrite-trace）—— import 触发 process.exit 会把调用方脚本一起带走，输出看着像跑完了其实全空。 */
import { fileURLToPath as __furl } from 'node:url'
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === __furl(import.meta.url)
const li = process.argv.indexOf('--live')
const LIVE = li > 0 && process.argv[li + 1] ? path.resolve(process.argv[li + 1]) : HERE

/** 与活树尺同口径切节：只认 1~3 级标题，代码围栏里的 # 不算。口径不同就会假红。 */
export function sectionsOf(text) {
  const lines = String(text).split(/\r?\n/)
  const fence = []
  let open = false
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) { open = !open; fence[i] = true; continue }
    fence[i] = open
  }
  const out = []
  let cur = null
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]
    if (!fence[i] && /^#{1,3} /.test(l)) { if (cur) out.push(cur); cur = { title: l.trim(), body: [] }; continue }
    if (cur) cur.body.push(l)
  }
  if (cur) out.push(cur)
  return out
}

/**
 * 判 stale。
 * drift > 0 = 账本长了但基线没归档（本轮要抓的那格）
 * drift < 0 = 基线大于账本，有节被吃掉（活树尺已管，这里一并报，不放松）
 */
export function judge({ ledgerText, baseline }) {
  if (ledgerText === null || ledgerText === undefined) return { ok: false, live: null, baseline: null, drift: null, why: '账本读不到' }
  if (!baseline || typeof baseline.sections !== 'number') return { ok: false, live: null, baseline: null, drift: null, why: '基线缺失或不可解析' }
  const live = sectionsOf(ledgerText).length
  const drift = live - baseline.sections
  if (drift === 0) return { ok: true, live, baseline: baseline.sections, drift, why: '同步' }
  return {
    ok: false, live, baseline: baseline.sections, drift,
    why: drift > 0 ? `账本比基线多 ${drift} 节，基线未归档（跑 --rerun）` : `账本比基线少 ${-drift} 节，有节被吃掉`,
  }
}

/**
 * 语义档活性（持久断言，不靠某一轮演出一次）：
 *   当前 baseline 的 sections 值，必须在 baseline-snapshots/ 下留下一份内容一致的归档。
 *   缺档 → 报 [未归档]：改了活树当前值却没留抄改前现场，正是 D-7 要拦的那格。
 * 只读不写：归档动作属审计脚本，裁定动作是本函数所在的尺子，两件事分家。
 */
export function judgeArchive({ ledgerText, baseline, snapshotDir }) {
  const live = sectionsOf(ledgerText ?? '').length
  if (!baseline || typeof baseline.sections !== 'number') {
    return { ok: false, live, archived: null, why: '基线缺失，无从谈归档' }
  }
  let hits = []
  try {
    hits = fs.readdirSync(snapshotDir)
      .filter((f) => /^ledger-structure\.baseline-.*\.json$/.test(f) && !/note/.test(f))
      .filter((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(snapshotDir, f), 'utf8')).sections === baseline.sections } catch { return false }
      })
  } catch { hits = [] }
  if (hits.length === 0) {
    return { ok: false, live, archived: 0, why: `[未归档] 当前 sections=${baseline.sections} 在 baseline-snapshots/ 无一致归档` }
  }
  return { ok: true, live, archived: hits.length, why: `已归档 ${hits.length} 份` }
}

function readLive() {
  const lp = path.join(LIVE, 'docs', 'audits', 'MERGE-LEDGER.md')
  const bp = path.join(LIVE, 'scripts', 'ledger-structure.baseline.json')
  const ledgerText = fs.existsSync(lp) ? fs.readFileSync(lp, 'utf8') : null
  let baseline = null
  if (fs.existsSync(bp)) { try { baseline = JSON.parse(fs.readFileSync(bp, 'utf8')) } catch { baseline = null } }
  return { ledgerText, baseline, lp, bp }
}

export function selfTest() {
  const cases = []
  const mk = (n) => Array.from({ length: n }, (_, i) => `### 节 ${i + 1}\n\n内容。\n`).join('\n')
  const push = (name, r, want) => cases.push({ name, ok: r, got: String(want) })
  let r = judge({ ledgerText: mk(5), baseline: { sections: 4 } })
  push('阳性·账本追加未归档必报', r.ok === false && r.drift === 1, r.why)
  r = judge({ ledgerText: mk(3), baseline: { sections: 4 } })
  push('阳性·账本少一节必报', r.ok === false && r.drift === -1, r.why)
  r = judge({ ledgerText: mk(4), baseline: { sections: 4 } })
  push('阴性·同步时不报', r.ok === true, r.why)
  r = judge({ ledgerText: mk(4), baseline: null })
  push('阳性·基线缺件必报不缩步', r.ok === false, r.why)
  r = judge({ ledgerText: null, baseline: { sections: 4 } })
  push('阳性·账本读不到必报', r.ok === false, r.why)
  const fenced = ['```text', '### 这不是节', '```', '', '### 真节', '', '内容。', ''].join('\n')
  push('阴性·围栏内 # 不计节', sectionsOf(fenced).length === 1, `节数=${sectionsOf(fenced).length}`)
  const h4 = ['## 二级', '', '正文', '', '#### 四级不算', '', '正文'].join('\n')
  push('阴性·四级标题不计节', sectionsOf(h4).length === 1, `节数=${sectionsOf(h4).length}`)

  // 语义档活性（持久断言）：当前 sections 无一致归档 → 必报 [未归档]，有则放行。
  // 全用 mkdtemp 独立 fixture，不碰真目录，也不靠某一轮演出一次。
  const mkSnap = (sections) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbs-snap-'))
    if (sections !== null) fs.writeFileSync(path.join(dir, 'ledger-structure.baseline-TEST.json'), JSON.stringify({ sections, at: 'x' }), 'utf8')
    return dir
  }
  r = judgeArchive({ ledgerText: mk(4), baseline: { sections: 4 }, snapshotDir: mkSnap(null) })
  push('阳性·改了活树当前值但没归档 -> 必报未归档', r.ok === false && /未归档/.test(r.why), r.why)
  r = judgeArchive({ ledgerText: mk(4), baseline: { sections: 4 }, snapshotDir: mkSnap(4) })
  push('阴性·留了一致归档 -> 放行', r.ok === true, r.why)
  r = judgeArchive({ ledgerText: mk(4), baseline: { sections: 4 }, snapshotDir: mkSnap(99) })
  push('阳性·归档内容不符仍报未归档（防留个同名空壳换绿）', r.ok === false, r.why)

  return cases
}

if (IS_MAIN) {
if (process.argv.includes('--self-test')) {
  const cs = selfTest()
  let pass = 0
  for (const c of cs) { if (c.ok) { pass += 1; continue } console.log(`FAIL ${c.name} → ${c.got}`) }
  console.log(`self-test ${pass}/${cs.length} 通过`)
  const { ledgerText, baseline } = readLive()
  const r = judge({ ledgerText, baseline })
  console.log(`读取根：${LIVE}`)
  if (li < 0) console.log('  ⚠ 未传 --live，下面这行读的是本脚本所在树；副本树为旧态快照，其节数/基线不作判据，只证明代码能跑（fixture 模式）')
  console.log(`活树现值：账本 ${r.live} 节 / 基线 ${r.baseline} / drift ${r.drift} → ${r.why}`)
  console.log('[check-baseline-stale][END]')
  process.exit(pass === cs.length ? 0 : 1)
}

const { ledgerText, baseline, bp } = readLive()
const r = judge({ ledgerText, baseline })
console.log(`[check-baseline-stale] ${FIXTURE_MODE ? 'fixture 模式（未传 --live，下面数字不作判据）读取：' : '判据只读活树当前值：'}${bp}`)
console.log(`[check-baseline-stale] 账本 ${r.live} 节 / 基线 ${r.baseline} / drift ${r.drift} → ${r.why}`)
/* 归档语义档判定（只读）：当前 sections 必须在 baseline-snapshots/ 留下一致归档 */
const arc = judgeArchive({ ledgerText, baseline, snapshotDir: path.join(LIVE, 'docs', 'audits', 'ship-evidence', 'baseline-snapshots') })
console.log(`[check-baseline-stale] 归档语义档判定：${arc.why}`)
console.log('[check-baseline-stale][END]')
/* fixture 模式退出码恒 0：旧态快照既不判红也不判绿，判据必须显式 --live */
process.exit(FIXTURE_MODE ? 0 : (r.ok && arc.ok ? 0 : 1))
}
