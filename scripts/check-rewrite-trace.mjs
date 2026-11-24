/**
 * 产方重写留痕尺（审计专用 · 非交付件，未进主树 registry）· 整件重写版
 *
 * 你裁：产方重写必须留一行 refetch-log（旧/新 sha + bytes + 时点 + who），
 * 否则「静默重生成」还会把同一件劈成两个时点的字节数（pending-refreeze 135304 → 135301 即此）。
 *
 * 判据：产方件盘上 mtime 晚于最后一次「产方重写」留痕、或压根没留痕 → 红。
 * 留痕行须带 旧bytes/新bytes/旧sha/新sha/时点/who；旧值确实拿不到须写 [不可考·旧值已丢失]，不得留空。
 *
 * 用法：node scripts/check-rewrite-trace.mjs [--self-test] [--live <根>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const li = process.argv.indexOf('--live')
const LIVE = li > 0 && process.argv[li + 1] ? path.resolve(process.argv[li + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_MODE = li < 0
const IS_MAIN = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
/* 字段齐备要求按 kind 分口径：
   产方重写 → 必须有 旧/新 bytes 与 sha（这才叫留痕，能对上两个时点）；
   尺子自产物（归档快照）→ 由 R-ARCH-2 管 sha/mtime/who/frameId/触发行，此处只要求 sha 与时点，
   不逼它编造「旧 bytes」—— 归档件的语义是抄改前现场，不是重写前后对比。 */
const NEED_BY_KIND = {
  '产方重写': ['旧bytes', '新bytes', '旧sha', '新sha', '时点', 'who'],
  '尺子自产物': ['sha256', '时点', 'who'],
}
const NEED_DEFAULT = ['时点', 'who']
/** kind 枚举写死：不在枚举内的 kind 不得充当留痕（须先补裁定再扩表） */
export const KINDS = ['产方重写', '尺子自产物']
export function judgeUnknownKind(entries) {
  const bad = []
  for (const e of (entries ?? [])) {
    const k = String(e.kind ?? '')
    if (!k) continue
    if (!KINDS.some((x) => k.indexOf(x) === 0)) bad.push('未知 kind：' + k + ' @ ' + e.obj + ' —— 不在枚举内不得充当留痕')
  }
  return { ok: bad.length === 0, bad }
}

/** 产方件清单：谁写它、写盘点在哪（现扫定位） */
export const PRODUCERS = [
  { path: 'docs/audits/ship-evidence/pending-refreeze.json', 产方: 'scripts/union-pending.mjs', 写盘点: 'L61 fs.writeFileSync(OUT, ...)' },
  { path: 'docs/audits/ship-evidence/adjudication-prefill.json', 产方: 'scripts/prefill-adjudication.mjs', 写盘点: 'L355 fs.writeFileSync(out, ...)' },
  { path: 'scripts/ledger-structure.baseline.json', 产方: 'scripts/check-ledger-structure.mjs --rerun', 写盘点: '--rerun 写回对象', 认可kind: ['产方重写', '尺子自产物'] },
]

/** 留痕行按 obj 归组（一次建表，不在循环里反复 filter） */
export function groupTraces(traces) {
  const m = new Map()
  for (const t of (traces ?? [])) {
    const k = String(t.obj ?? '')
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(t)
  }
  for (const arr of m.values()) arr.sort((a, b) => String(a.时点).localeCompare(String(b.时点)))
  return m
}

export function judgeRewrites({ root, producers, traces }) {
  const bad = []
  const rows = []
  const byObj = groupTraces(traces)
  for (const p of producers) {
    /* 认可kind：该产方件的写入可以由哪些 kind 的留痕行交代。
       默认只认「产方重写」；尺子自产物（如 ledger baseline）每次 --rerun 都写，
       由归档两步一体逐次登记，故也认「尺子自产物」。 */
    const kinds = p.认可kind ?? ['产方重写']
    const mine = (byObj.get(p.path) ?? []).filter((t) => kinds.some((k) => String(t.kind ?? '').indexOf(k) >= 0))
    const abs = path.join(root, p.path)
    if (!fs.existsSync(abs)) { rows.push({ path: p.path, 产方: p.产方, 在位: false, 留痕行数: 0 }); continue }
    const st = fs.statSync(abs)
    const last = mine.length ? mine[mine.length - 1] : null
    rows.push({ path: p.path, 产方: p.产方, 写盘点: p.写盘点, 在位: true, bytes: st.size, mtime: st.mtime.toISOString(), 留痕行数: mine.length, 最后留痕时点: last ? last.时点 : null })
    if (mine.length === 0) {
      bad.push(`产方重写未留痕：${p.path} —— mtime ${st.mtime.toISOString()}，无任何认可 kind（${kinds.join('/')}）的留痕行（产方 ${p.产方}，写盘点 ${p.写盘点}）`)
    } else if (last && new Date(st.mtime.toISOString()) > new Date(String(last.时点))) {
      bad.push(`产方重写未留痕：${p.path} —— mtime ${st.mtime.toISOString()} 晚于最后留痕 ${last.时点}，中间有未登记写入`)
    }
    for (const t of mine) {
      const kindKey = Object.keys(NEED_BY_KIND).find((k) => String(t.kind ?? '').indexOf(k) >= 0)
      const need = kindKey ? NEED_BY_KIND[kindKey] : NEED_DEFAULT
      const miss = need.filter((k) => t[k] === undefined || t[k] === null || String(t[k]).trim() === '')
      if (miss.length) bad.push(`留痕行字段不全：${t.obj} @ ${t.时点 ?? t.at ?? '(无时点)'} [kind=${t.kind}] 缺 ${miss.join('/')}（旧值拿不到须写 [不可考·旧值已丢失]，不得留空）`)
    }
  }
  return { ok: bad.length === 0, bad, rows }
}

export function selfTest() {
  const cases = []
  const push = (name, ok, got) => cases.push({ name, ok: !!ok, got: String(got) })
  const root = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMP || '/tmp', 'crt-'))
  const f = path.join(root, 'a.json')
  fs.writeFileSync(f, '{"a":1}', 'utf8')
  const P = [{ path: 'a.json', 产方: 'p.mjs', 写盘点: 'L1' }]
  const future = new Date(Date.now() + 3600000).toISOString()
  const past = '2000-01-01T00:00:00.000Z'
  const full = (o) => ({ kind: '产方重写', obj: 'a.json', 旧bytes: 7, 新bytes: 7, 旧sha: 'x'.repeat(64), 新sha: 'y'.repeat(64), who: '昔涟', ...o })
  const other = (o) => ({ kind: '尺子自产物', obj: 'a.json', sha256: 'z'.repeat(64), 旧bytes: 7, 新bytes: 7, 旧sha: 'x'.repeat(64), 新sha: 'y'.repeat(64), who: '昔涟', ...o })

  let r = judgeRewrites({ root, producers: P, traces: [] })
  push('阳性·产方件零留痕必报', r.ok === false && /未留痕/.test(r.bad[0] ?? ''), r.bad[0] ?? '(未报)')
  r = judgeRewrites({ root, producers: P, traces: [full({ 时点: future })] })
  push('阴性·留痕晚于 mtime 则放行', r.ok === true, JSON.stringify(r.bad))
  r = judgeRewrites({ root, producers: P, traces: [full({ 时点: past })] })
  push('阳性·留痕早于 mtime（中间有未登记写入）必报', r.bad.some((b) => /晚于最后留痕/.test(b)), r.bad.find((b) => /晚于/.test(b)) ?? '(未报)')
  const hole = full({ 时点: future }); delete hole['旧sha']; delete hole['旧bytes']
  r = judgeRewrites({ root, producers: P, traces: [hole] })
  push('阳性·留痕行缺旧 sha/旧 bytes 必报', r.bad.some((b) => /字段不全/.test(b)), r.bad.find((b) => /字段不全/.test(b)) ?? '(未报)')
  r = judgeRewrites({ root, producers: P, traces: [full({ 时点: future, 旧sha: '[不可考·旧值已丢失]' })] })
  push('阴性·旧值明写不可考则放行', r.ok === true, JSON.stringify(r.bad))
  r = judgeRewrites({ root, producers: P, traces: [full({ 时点: future }), full({ 时点: future })] })
  push('阴性·同件多次留痕按最后一次判', r.ok === true, JSON.stringify(r.bad))
  r = judgeRewrites({ root, producers: P, traces: [other({ 时点: future })] })
  push('阳性·kind 不在认可清单则不算留痕', r.ok === false && /未留痕/.test(r.bad[0] ?? ''), r.bad[0] ?? '(未报)')
  const P2 = [{ path: 'a.json', 产方: 'p.mjs', 写盘点: 'L1', 认可kind: ['产方重写', '尺子自产物'] }]
  r = judgeRewrites({ root, producers: P2, traces: [other({ 时点: future })] })
  push('阴性·认可kind 显式放宽后放行（尺子自产物那类）', r.ok === true, JSON.stringify(r.bad))
  const ukc = judgeUnknownKind([{ kind: '产方重写（补登）', obj: 'a.json' }, { kind: '随手编的kind', obj: 'b.json' }])
  cases.push({ name: '阳性·未知 kind 必红（不在枚举内不得充当留痕）', ok: ukc.bad.some((b) => /未知 kind/.test(b)), got: ukc.bad.map((b) => b.slice(0, 58)).join(' ⏎ ') })
  fs.rmSync(root, { recursive: true, force: true })
  return cases
}

function main() {
  const regPath = path.join(LIVE, 'docs', 'audits', 'ship-evidence', 'baseline-snapshots', 'refetch-log.json')
  let entries = []
  if (fs.existsSync(regPath)) entries = JSON.parse(fs.readFileSync(regPath, 'utf8')).entries ?? []
  const r = judgeRewrites({ root: LIVE, producers: PRODUCERS, traces: entries })
  const uk = judgeUnknownKind(entries)
  console.log(`[check-rewrite-trace] 读取树：${LIVE}${FIXTURE_MODE ? '（fixture 模式：未传 --live，不作判据，exit 恒 0）' : ''}`)
  console.log(`[check-rewrite-trace] 产方件 ${r.rows.length} 个 | refetch-log entries ${entries.length} 行（按各件 认可kind 分别筛）`)
  for (const x of r.rows) console.log(`  ${x.在位 ? '在位' : '缺件'} ${x.path} | 产方 ${x.产方} | ${x.在位 ? 'bytes ' + x.bytes + ' mtime ' + x.mtime.slice(0, 19) + ' ' : ''}留痕 ${x.留痕行数} 行${x.最后留痕时点 ? ' 最后 ' + String(x.最后留痕时点).slice(0, 19) : ''}`)
  for (const b of [...r.bad, ...uk.bad]) console.log('  X ' + b)
  console.log(`[check-rewrite-trace] ${r.ok ? 'OK：产方重写全部有留痕且字段齐' : 'FAIL：' + r.bad.length + ' 项'}`)
  console.log('[check-rewrite-trace][END]')
  process.exit(FIXTURE_MODE ? 0 : (r.ok && uk.ok ? 0 : 1))
}

if (process.argv.includes('--self-test')) {
  const cs = selfTest()
  let pass = 0
  for (const c of cs) { if (c.ok) { pass += 1; continue } console.log(`FAIL ${c.name} → ${c.got}`) }
  console.log(`self-test ${pass}/${cs.length} 通过`)
  console.log('[check-rewrite-trace][END] fixture=1')
  process.exit(pass === cs.length ? 0 : 1)
}
if (IS_MAIN) main()
