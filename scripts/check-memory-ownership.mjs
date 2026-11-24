/*
 * check-memory-ownership.mjs —— 乙2 四键权威归属闸
 *
 * 裁定（2026-11-24 主人）：四键归属落地，不重议——
 *   自动记忆 / 条数 / QQ 隐私 → 设置页（schema 生成控件）是唯一编辑权威；
 *   视图（memoryViewMode）→ 记忆台是唯一编辑权威，且落盘（PUT /companion/memory 已有）；
 *   记忆台里「自动记忆」降只读行、QQ 手写的隐私模式按钮降只读、
 *   schema 的 memoryViewMode 条目撤下、写死「每轮最多收 8 条」改读真值。
 * :3367 注释早写好了本分：「schema 单一事实源，设置页只消费不重复登记」。
 * 双写通道一起拆：客户端调用点、body.enabled 映射、服务端 PUT 里 memoryEnabled 处理，三层都不留。
 * bridge 两键现状已合规（schema 定义 + 唯一 PUT 写侧），本闸立守卫防再长出第二处。
 *
 * 判据：
 *   R1a client.js 不得出现 memoryEnabled 的 checkbox 写点（event.target.checked 提交）
 *   R1b lib/index.js 的 /companion/memory 处理不得再写 state.memoryEnabled（body.enabled 旧通道）
 *   R2a schema FIELDS 不得再含 memoryViewMode 可编辑条目（权威在记忆台）
 *   R2b client.js 必须仍有 memoryViewMode 写点（守卫：权威存在，删了也红）
 *   R3  bridge 两键：schema 恰各一条 + client.js 无第二写点（守卫，现状绿）
 *   R4  client.js 不得有隐私模式手写的 patchQq({ privacyMode: … === false }) 翻转写点
 *   R5  「每轮最多收 N 条」文案禁字面数字，必须引用 state.memoryPerRoundLimit
 *   R6  lib/index.js publicState 必须下发 memoryPerRoundLimit（取 PER_ROUND_LIMIT 真值）
 *
 * 用法：node scripts/check-memory-ownership.mjs [--self-test]
 *   code=0 绿 / 1 红 / 2 环境不满足
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIELDS } from '../lib/settings-schema.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'lib', 'client.js')
const INDEX = join(ROOT, 'lib', 'index.js')

function evaluate(clientSrc, indexSrc, fields) {
  const rows = []
  const push = (name, ok, detail = '') => rows.push({ name, ok, detail })
  const hasViewMode = fields.some((f) => f.key === 'memoryViewMode')
  const bridgeCount = (k) => fields.filter((f) => f.key === k).length

  const r1a = /memoryEnabled:\s*event\.target\.checked/.test(clientSrc)
  push('R1a·记忆台无 memoryEnabled 写点', !r1a, r1a ? 'checkbox 提交还在 client.js' : '')

  const r1b = /state\.memoryEnabled\s*=\s*body\.?enabled|body\.enabled\s*!==\s*undefined[\s\S]{0,120}state\.memoryEnabled/.test(indexSrc)
  push('R1b·/companion/memory 不再写 state.memoryEnabled', !r1b, r1b ? 'PUT 处理里 body.enabled→memoryEnabled 通道还在' : '')

  push('R2a·schema 无 memoryViewMode 可编辑条目', !hasViewMode, hasViewMode ? 'FIELDS 里还有 memoryViewMode 条目' : '')
  const r2b = /memoryViewMode:\s*event\.target\.checked/.test(clientSrc)
  push('R2b·记忆台保留 memoryViewMode 写点（权威在场）', r2b, r2b ? '' : '权威写点没了——视图没人能切了')

  const bp = bridgeCount('memoryBridgePrivate')
  const bg = bridgeCount('memoryBridgeGroup')
  const r3 = bp === 1 && bg === 1 && !/memoryBridge(Private|Group):\s*(event|state)/.test(clientSrc)
  push('R3·bridge 两键 schema 恰一条且无第二写点', r3, `private=${bp} group=${bg}`)

  const r4 = /patchQq\(\s*\{?\s*privacyMode:\s*state\?\.qq\?\.privacyMode\s*===\s*false/.test(clientSrc)
  push('R4·QQ 手写隐私模式翻转按钮已撤', !r4, r4 ? 'patchQq({ privacyMode: … === false }) 还在' : '')

  const r5lit = /每轮最多收\s*\d/.test(clientSrc)
  const r5ref = clientSrc.includes('memoryPerRoundLimit')
  push('R5·条数文案读真值禁字面', !r5lit && r5ref, `${r5lit ? '字面数字还在' : '无字面'}·${r5ref ? '有引用' : '未引用 state.memoryPerRoundLimit'}`)

  const r6 = /memoryPerRoundLimit:\s*PER_ROUND_LIMIT/.test(indexSrc)
  push('R6·publicState 下发 memoryPerRoundLimit 真值', r6, r6 ? '' : '面板拿不到真值，文案没源可读')
  return rows
}

if (process.argv.includes('--self-test')) {
  const GOOD_C = `saveMemorySettings({ memoryViewMode: event.target.checked ? 'all' : 'owner' });
    \`默认开启，每轮最多收 \${state.memoryPerRoundLimit} 条\`; const x = state.memoryEnabled === false`
  const GOOD_I = 'if (changed) await persist(); memoryPerRoundLimit: PER_ROUND_LIMIT,'
  const GOOD_F = [
    { key: 'memoryEnabled' }, { key: 'memoryBridgePrivate' }, { key: 'memoryBridgeGroup' },
  ]
  const cases = [
    { expectRed: false, label: '全合规帧应绿', c: GOOD_C, i: GOOD_I, f: GOOD_F },
    { expectRed: true, label: 'R1a·checkbox 写点应红', c: GOOD_C + '\nsaveMemorySettings({ memoryEnabled: event.target.checked })', i: GOOD_I, f: GOOD_F },
    { expectRed: true, label: 'R1b·body.enabled 旧通道应红', c: GOOD_C, i: GOOD_I + '\nstate.memoryEnabled = body.enabled', f: GOOD_F },
    { expectRed: true, label: 'R2a·schema 留 viewMode 应红', c: GOOD_C, i: GOOD_I, f: [...GOOD_F, { key: 'memoryViewMode' }] },
    { expectRed: true, label: 'R5·字面数字应红', c: GOOD_C.replace('${state.memoryPerRoundLimit}', '8'), i: GOOD_I, f: GOOD_F },
    { expectRed: true, label: 'R2b·权威写点丢失也应红（守卫反向）', c: GOOD_C.replace('memoryViewMode: event.target.checked', 'memoryViewMode: 0'), i: GOOD_I, f: GOOD_F },
  ]
  let bad = 0
  for (const cse of cases) {
    const hasRed = evaluate(cse.c, cse.i, cse.f).some((r) => !r.ok)
    const pass = hasRed === cse.expectRed
    if (!pass) bad++
    console.log(`  ${pass ? (hasRed ? 'CAUGHT    ' : 'GREEN-OK  ') : (hasRed ? 'UNEXPECTED' : 'MISSED    ')} ${cse.label}`)
  }
  console.log(`  坏例 ${bad}`)
  console.log(`[END] script=check-memory-ownership.mjs code=${bad > 0 ? 1 : 0}`)
  process.exit(bad > 0 ? 1 : 0)
}

let clientSrc = ''
let indexSrc = ''
try {
  clientSrc = readFileSync(CLIENT, 'utf8')
  indexSrc = readFileSync(INDEX, 'utf8')
} catch (error) {
  console.log(`  SKIP 源码读不到：${error?.message ?? error}`)
  console.log('[END] script=check-memory-ownership.mjs code=2')
  process.exit(2)
}
let bad = 0
for (const r of evaluate(clientSrc, indexSrc, FIELDS)) {
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  ${r.detail}`)
  if (!r.ok) bad++
}
console.log(`[check-memory-ownership] 红 ${bad} 条`)
console.log(`[END] script=check-memory-ownership.mjs code=${bad > 0 ? 1 : 0}`)
process.exit(bad > 0 ? 1 : 0)
