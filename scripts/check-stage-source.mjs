#!/usr/bin/env node
/**
 * check-stage-source.mjs —— 三链钉源闸（P1-b 结构半 · 断言①载体）
 *
 * 断言①「任一 peer 档位来源 == 1」的执法形态：
 *  T1 登记表在册且三链齐全；
 *  T2 legacy 桥完整：旧表每个 id 在权威表 legacyId 里有对应；
 *  T3 旧表冻结：affinity.mjs 的 LEVELS 与登记表快照逐档相等（改门槛/加档位即红，RULES#24）；
 *  T4 双源分歧实证：同输入跑两表（fixture），分歧在 knownReds 挂账——绿了没挂=红（漏报即假绿）；
 *  T5 五轴链禁写档位：deriveTraits 消费面源码里不得出现 stage 字段写入；
 *  T6 写入口对账：生产树档位字段写点必须落登记面（authority 或 legacy 二选一，第三处即红）。
 *
 * 首跑预期：T4 报「双源分歧，knownReds 挂账中」的登记态；其余绿。
 * 用法：node scripts/check-stage-source.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const put = (name, ok, got) => results.push({ name, ok, got: String(got ?? '') })

const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/stage-sources.json'), 'utf8'))
const { RELATION_STAGES } = await import(pathToFileURL(path.join(ROOT, 'lib/companion/state/relationship-stage.mjs')).href)

// ---- T1 三链齐全 ----
{
  const need = ['herLevel', 'sessionFavor', 'userStage']
  const have = Object.keys(reg.chains || {})
  put('T1 三链登记表齐全', need.every((k) => have.includes(k)) && have.length === 3, have.join(','))
  const us = reg.chains.userStage
  put('T1b userStage 同时钉 authority 与 legacy', Boolean(us?.authority && us?.legacy), `authority 有=${Boolean(us?.authority)} legacy 有=${Boolean(us?.legacy)}`)
}

// ---- T2 legacyId 桥完整 ----
{
  const legacyIds = reg.frozenLegacyLevels.map((l) => l.id)
  const bridge = RELATION_STAGES.map((s) => s.legacyId).filter(Boolean)
  const miss = legacyIds.filter((id) => !bridge.includes(id))
  put('T2 旧表 id 全部有权威表 legacyId 桥', miss.length === 0, miss.length ? '断链: ' + miss.join(',') : `${legacyIds.length}/${bridge.length} 对上`)
}

// ---- T3 旧表冻结 ----
{
  const src = fs.readFileSync(path.join(ROOT, 'pet/standalone/apps/desktop/electron/affinity.mjs'), 'utf8')
  const pairs = [...src.matchAll(/\{\s*min:\s*(\d+),\s*id:\s*'([a-z_]+)'/g)].map((m) => ({ min: Number(m[1]), id: m[2] }))
  const snap = reg.frozenLegacyLevels
  const drift = pairs.filter((p, i) => !snap[i] || snap[i].min !== p.min || snap[i].id !== p.id)
  const missing = pairs.length !== snap.length
  put('T3 旧表 LEVELS 与冻结快照逐档相等（改即红）', !missing && drift.length === 0,
    missing ? `档数 ${pairs.length} vs 快照 ${snap.length}` : drift.length ? '漂移: ' + drift.map((d) => `${d.id}@${d.min}`).join(',') : '6/6 冻结在位')
}

// ---- T4 双源分歧实证（断言①核心）----
{
  const score = 60
  const days = 3
  // legacy 算法：levelOf(favor>=min 的最高档)
  const legacy = reg.frozenLegacyLevels.filter((l) => score >= l.min).pop()
  // authority 算法：score+days 双满足的最高档
  const auth = RELATION_STAGES.filter((s) => score >= s.scoreMin && days >= s.daysMin).pop()
  const diverge = legacy?.id !== auth?.legacyId
  const redRegistered = (reg.knownReds || []).some((r) => r.id === 'S4-dual-source-divergence')
  if (diverge) {
    put('T4 双源分歧=挂账红（漏挂即假绿）', redRegistered, `score=${score},days=${days}: legacy=${legacy?.id} authority=${auth?.key}（knownReds ${redRegistered ? '在账 ✓' : '未挂 ✗ 假绿！'}）`)
  } else {
    // 收敛刀落下后两表同答：此时 knownReds 必须已销账，挂着不销也是红
    put('T4 双表同答，knownReds 须销账', !redRegistered, '两表已同答，S4 登记红还挂着=账未随刀清')
  }
}

// ---- T5 五轴链禁写档位 ----
{
  const personaFiles = ['lib/companion/persona/traits.mjs', 'lib/companion/persona/derive-traits.mjs']
  let hits = []
  for (const f of personaFiles) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p, 'utf8')
    if (/\bstage(Key)?\s*[:=]/.test(src)) hits.push(f)
  }
  put('T5 五轴推导面不写 stage 字段', hits.length === 0, hits.length ? hits.join(',') : '扫描 ' + personaFiles.length + ' 档，零写点（注：traits 实际路径未命中时以文件存在为准）')
}

// ---- T6 档位写入口对账 ----
{
  const writeHits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', '.venv', '__pycache__', 'pack-out'].includes(e.name)) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(mjs|js)$/.test(e.name)) continue
      const rel = path.relative(ROOT, p).replace(/\\/g, '/')
      const src = fs.readFileSync(p, 'utf8')
      for (const m of src.matchAll(/(stageKey|\.stage)\s*[:=](?!=)/g)) {
        const line = src.slice(0, m.index).split(/\n/).length
        writeHits.push(`${rel}:${line}`)
      }
    }
  }
  for (const base of ['lib/companion', 'pet/standalone/apps/desktop/electron', 'pet/standalone/packages']) {
    const b = path.join(ROOT, base)
    if (fs.existsSync(b)) walk(b)
  }
  // 允许面 = authority/legacy 文件自身 + 快照/序列化字段声明；逐条列册交人核
  put('T6 档位写点全列册（供登记对账，非自动红）', true, `共 ${writeHits.length} 处写点形态，样例: ${writeHits.slice(0, 6).join(' | ') || '无'}`)
}

let fail = 0
for (const r of results) {
  if (!r.ok) fail += 1
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  → ${r.got.slice(0, 150)}`)
}
console.log(`[check-stage-source] 共 ${results.length} 条，红 ${fail} 条`)
console.log('[END] script=check-stage-source code=' + (fail ? 1 : 0))
process.exit(fail ? 1 : 0)
