/*
 * check-bak-storm.mjs —— 明文 .bak 风暴闸（.bak 格 · 停新增的持续看守）
 *
 * 裁定（2026-11-24 主人）：明文念头历史是红线；含内容的 thoughts/body 不再落明文 .bak，
 * 策略收成最近 3 份 + 按天归并留 7 天；清理存量 13900 个仍不批，等三前提
 * （停新增已验生效 / 存量有可恢复处置 / 删除有 baseline 可核对）。
 *
 * 取证（2026-11-24 00:15）：顶层带 13 位时间戳 .bak 共 13900（thoughts 9316 / body 4584），
 * 最后一份 2026-11-22 19:42:48 后再没长；本体 thoughts.json 仍在写（当天 23:12）却不落新 bak——
 * 停新增已自然成立（密封仓库收口把旧顶层备份路径换掉了）。本闸把「自己停了」冻成断言持续看守，
 * 并且它就是三前提里的第三件：baseline 可核对。第一份带时间戳的新文件出现 = 当场点名红。
 *
 * 判据：
 *   K1 数量：顶层带时间戳 .bak ≤ baseline.totalStamped（存量清理获批后会变少，变少不算红）
 *   K1b 新写：任何内嵌时间戳 > baseline.maxStamp 的文件 = 又落明文了 → 红（计数被绕过也逮得住）
 *   K2 策略：.backup/ 里每个 base 的份数 ≤ 3（backupKeep 的裁定值；目录不存在=当前写入者不落备份，过）
 *   K3 固定名：非时间戳 .bak 名单与 baseline.fixedBak 一致，新名字出现 = 红
 *
 * 闸自身防自套白：--freeze 只允许在 baseline 不存在时落一次；已有 baseline 时拒绝再冻，
 * 改 baseline = 掏空判据，跟 boundaryExemptMax「sync 不得抬高」同法。
 * 数据目录不硬编码：默认 homedir/.dsh/storages/cyrene-pet，测试用 --dir 指 fixture。
 *
 * 用法：node scripts/check-bak-storm.mjs [--freeze|--self-test|--dir <path>]
 *   code=0 绿 / 1 红（或冻结被拒）/ 2 目录不存在
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = join(ROOT, 'scripts', 'bak-storm.baseline.json')
const STAMPED = /^(.+\.json)\.(\d{13})\.bak$/
const FIXED = /\.bak$/
const KEEP_MAX = 3

function defaultDir() {
  return join(homedir(), '.dsh', 'storages', 'cyrene-pet')
}

function evaluate(dir, baseline) {
  const rows = []
  const names = readdirSync(dir)
  const stamped = []
  const fixed = []
  for (const n of names) {
    const m = STAMPED.exec(n)
    if (m) stamped.push({ kind: m[1], ts: Number(m[2]) })
    else if (FIXED.test(n)) fixed.push(n)
  }
  const maxStamp = stamped.reduce((a, s) => (s.ts > a ? s.ts : a), 0)

  if (stamped.length > baseline.totalStamped) {
    rows.push({ ok: false, name: `K1·顶层带时间戳 .bak ≤ ${baseline.totalStamped}`, detail: `实测 ${stamped.length}，比存量还多` })
  } else {
    rows.push({ ok: true, name: `K1·顶层带时间戳 .bak ≤ ${baseline.totalStamped}`, detail: `实测 ${stamped.length}${stamped.length < baseline.totalStamped ? '（低于存量：清理已获批执行？）' : ''}` })
  }

  const fresh = stamped.filter((s) => s.ts > baseline.maxStamp)
  if (fresh.length > 0) {
    const latest = fresh.reduce((a, s) => (s.ts > a.ts ? s : a))
    rows.push({ ok: false, name: 'K1b·没有新的明文 .bak 落下', detail: `${fresh.length} 份晚于冻结时刻，最新 ${latest.kind}@${new Date(latest.ts).toISOString().slice(0, 19)}` })
  } else {
    rows.push({ ok: true, name: 'K1b·没有新的明文 .bak 落下', detail: `最新内嵌戳停在冻结时刻` })
  }

  const backupDir = join(dir, '.backup')
  if (existsSync(backupDir)) {
    const counts = new Map()
    for (const n of readdirSync(backupDir)) {
      const m = STAMPED.exec(n)
      if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
    }
    const over = [...counts.entries()].filter(([, c]) => c > KEEP_MAX)
    rows.push({ ok: over.length === 0, name: `K2·.backup/ 每 base ≤ ${KEEP_MAX} 份`, detail: over.length ? over.map(([k, c]) => `${k}:${c}`).join(', ') : (counts.size === 0 ? '目录在但无带戳备份' : `${counts.size} 个 base 全部达标`) })
  } else {
    rows.push({ ok: true, name: `K2·.backup/ 每 base ≤ ${KEEP_MAX} 份`, detail: '.backup/ 不存在：当前写入者不落备份' })
  }

  const known = new Set(baseline.fixedBak)
  const newFixed = fixed.filter((n) => !known.has(n))
  rows.push({ ok: newFixed.length === 0, name: 'K3·固定名 .bak 无新增', detail: newFixed.length ? `新增 ${newFixed.join(', ')}` : `${fixed.length} 份与存量一致` })
  return rows
}

const argv = process.argv.slice(2)
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

if (argv.includes('--self-test')) {
  const FIX = join(ROOT, 'tmp', 'bak-storm-fix')
  rmSync(FIX, { recursive: true, force: true })
  mkdirSync(FIX, { recursive: true })
  const B = { totalStamped: 2, maxStamp: 1700000000000, fixedBak: ['a.json.bak'], frozenAt: 'fixture' }
  const touch = (n) => writeFileSync(join(FIX, n), '{"x":1}')
  touch('a.json.1700000000000.bak'); touch('a.json.1699999999000.bak'); touch('a.json.bak')
  const cases = [
    { expectRed: false, label: '冻结态应绿', setup: () => {} },
    { expectRed: true, label: 'K1b·新时间戳注入应红', setup: () => { touch('a.json.1700000001000.bak') } },
    { expectRed: true, label: 'K2·.backup 超份应红', setup: () => {
      touch('a.json.1700000002000.bak')
      mkdirSync(join(FIX, '.backup'), { recursive: true })
      for (let i = 0; i < 4; i++) writeFileSync(join(FIX, '.backup', `b.json.${1700000000000 + i}.bak`), '{}')
    } },
    { expectRed: true, label: 'K3·新固定名应红', setup: () => { touch('c.json.sync.bak') } },
  ]
  let bad = 0
  for (const c of cases) {
    c.setup()
    const rows = evaluate(FIX, B)
    const hasRed = rows.some((r) => !r.ok)
    const pass = hasRed === c.expectRed
    if (!pass) bad++
    console.log(`  ${pass ? (hasRed ? 'CAUGHT    ' : 'GREEN-OK  ') : (hasRed ? 'UNEXPECTED' : 'MISSED    ')} ${c.label}`)
  }
  rmSync(FIX, { recursive: true, force: true })
  console.log(`  fixture 已清，坏例 ${bad}`)
  console.log(`[END] script=check-bak-storm.mjs code=${bad > 0 ? 1 : 0}`)
  process.exit(bad > 0 ? 1 : 0)
}

const dir = argOf('--dir') ?? defaultDir()
if (!existsSync(dir)) {
  console.log(`  SKIP 数据目录不存在：${dir}`)
  console.log('[END] script=check-bak-storm.mjs code=2')
  process.exit(2)
}

if (argv.includes('--freeze')) {
  if (existsSync(BASELINE)) {
    console.log('  ✗ baseline 已存在，拒绝再冻（改 baseline = 掏空判据；要动走台账新节讨论）')
    console.log('[END] script=check-bak-storm.mjs code=1')
    process.exit(1)
  }
  const names = readdirSync(dir)
  const stamped = []
  const fixedBak = []
  for (const n of names) {
    const m = STAMPED.exec(n)
    if (m) stamped.push(Number(m[2]))
    else if (FIXED.test(n)) fixedBak.push(n)
  }
  const base = {
    frozenAt: new Date().toISOString(),
    totalStamped: stamped.length,
    maxStamp: stamped.reduce((a, t) => (t > a ? t : a), 0),
    fixedBak: fixedBak.sort(),
    note: '存量=11-22 19:42 停长后冻结；本行以下数值不许被 --freeze 抬高（已有 baseline 直接拒冻）',
  }
  writeFileSync(BASELINE, JSON.stringify(base, null, 2) + '\n', 'utf8')
  console.log(`  [freeze] 存量 ${base.totalStamped} 份，最新戳 ${new Date(base.maxStamp).toISOString().slice(0, 19)}，固定名 ${base.fixedBak.length} 个已写入 baseline`)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
let bad = 0
for (const r of evaluate(dir, baseline)) {
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  ${r.detail}`)
  if (!r.ok) bad++
}
console.log(`[check-bak-storm] 红 ${bad} 条`)
console.log(`[END] script=check-bak-storm.mjs code=${bad > 0 ? 1 : 0}`)
process.exit(bad > 0 ? 1 : 0)
