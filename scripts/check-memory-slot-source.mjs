/*
 * check-memory-slot-source.mjs —— 记忆 13 槽「一处权威数据源」闸（乙1 · 甲案）
 *
 * 裁定（2026-11-24 主人）：开关写侧只在陪伴面板（lib/client.js:3491 → lib/index.js body.slots），
 * insight 抽屉是只读查看器，从无 checkbox。病不在「开关两处」，在两条数据源喂两个面：
 *   面板  state.memorySlots → activeMemorySlotIds()（lib/index.js:4795）
 *   抽屉  insight.mjs buildFactSlots 读 MEMORY_SLOTS 声明表静态默认（恒定漂移）
 * 甲案合流：插件把生效槽写进 live.json 的 memorySlotIds（buildLive payload，persist 内已有
 * await writeLive()，触发点本就存在），桌宠照 getIntimacyPeers 同形状注入 getActiveSlotIds，
 * 抽屉从注入值派生 enabled。桌宠只读 live.json / pet-command.json 两个白名单文件（main.mjs:5706），
 * 不读插件内部状态——公开快照不在白名单文件内，无例外可开。
 *
 * 权威源钉死：state.memorySlots 经 effectiveSlotIds() 归一后是唯一权威源。
 * 归一规则只许存在于 memory-slots.mjs 一处（G4 源码断言），lib/index.js 与抽屉都调它/读它的产物。
 *
 * 判据（真跑，不静态比源码猜行为）：
 *   G0 服务起得来：snapshot({force:true}) 的 factSlots 非空、13 槽齐（否则 code=2，环境不满足）
 *   G1 注入双向漂移 custom={knowledge:false, habit:true}（一启用槽关、一备用槽开），
 *      抽屉每槽 enabled 必须等于权威生效值
 *   G2 关槽的查看语义：enabled=false 的槽 count=0 且 samples 空（主人真机眼裁定：暗掉、条数归零；
 *      与陪伴面板「关掉的槽条目收进折叠区」同语义）
 *   G3 分辨力：注入与权威相反的生效值（全开），G1 型比较必须逮到分歧——逮不到说明闸是摆设
 *   G4 归一单一来源（源码断言）：memory-slots.mjs export effectiveSlotIds；
 *      lib/index.js activeMemorySlotIds 体调它；insight.mjs buildFactSlots 不再裸读 slot.enabled
 *
 * 用法：node scripts/check-memory-slot-source.mjs
 *   code=0 绿 / 1 红 / 2 环境不满足（红与起不来分开）
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInsightService } from '../pet/standalone/apps/desktop/electron/insight.mjs'
import { MEMORY_SLOTS } from '../lib/companion/memory/memory-slots.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rows = []
const push = (name, ok, detail = '') => rows.push({ name, ok, detail })

/* 权威生效值：与 lib/index.js:4797-4800 同规则（slot.id in custom ? custom[id]===true : 默认）。
   合流后这条规则归 effectiveSlotIds() 一处，G4 盯着不让第二份长出来。 */
const effectiveMap = (custom) => {
  const c = custom !== null && typeof custom === 'object' ? custom : {}
  const m = new Map()
  for (const slot of MEMORY_SLOTS) m.set(slot.id, slot.id in c ? c[slot.id] === true : slot.enabled)
  return m
}
const idsOf = (map) => MEMORY_SLOTS.filter((s) => map.get(s.id)).map((s) => s.id)

const CUSTOM = { knowledge: false, habit: true }
const AUTH = effectiveMap(CUSTOM)

const factStore = {
  load: async () => {},
  snapshot: () => ({
    all: 2, active: 2, archived: 0,
    facts: [
      { kind: 'knowledge', text: '闸样本条目甲', at: 1700000000000, archived: false, scope: 'desktop' },
      { kind: 'habit', text: '闸样本条目乙', at: 1700000001000, archived: false, scope: 'desktop' },
    ],
  }),
}

async function drawerWith(getActiveSlotIds) {
  const service = createInsightService({ factStore, cacheTtlMs: 0, getActiveSlotIds, log: () => {} })
  const snap = await service.snapshot({ force: true })
  return snap?.factSlots ?? null
}

const facts = await drawerWith(async () => idsOf(AUTH))
if (facts === null || !Array.isArray(facts.slots) || facts.slots.length !== MEMORY_SLOTS.length) {
  console.log('  SKIP 观察台服务起不来或 factSlots 不齐，判不了（红与起不来分开）')
  console.log('[END] script=check-memory-slot-source.mjs code=2')
  process.exit(2)
}
push('G0·观察台真跑、13 槽齐', true, `slots=${facts.slots.length}`)

/* G1 抽屉 enabled 对权威生效值 */
const drift = facts.slots.filter((s) => s.enabled !== AUTH.get(s.id))
push('G1·抽屉每槽 enabled 等于权威生效值（注入 knowledge 关 / habit 开）', drift.length === 0,
  drift.length ? drift.map((s) => `${s.id}: 抽屉=${s.enabled} 权威=${AUTH.get(s.id)}`).join(', ') : '13 槽全一致')

/* G2 关槽查看语义 */
const offBad = facts.slots.filter((s) => !s.enabled && (s.count !== 0 || (Array.isArray(s.samples) && s.samples.length > 0)))
push('G2·关掉的槽 count=0 且 samples 空（折叠语义）', offBad.length === 0,
  offBad.length ? offBad.map((s) => `${s.id}: count=${s.count} samples=${s.samples?.length ?? 0}`).join(', ') : '关槽皆折叠')

/* G3 分辨力：注入相反值必须被逮 */
const wrong = await drawerWith(async () => MEMORY_SLOTS.map((s) => s.id))
const wrongDrift = wrong === null ? [] : wrong.slots.filter((s) => s.enabled !== AUTH.get(s.id))
push('G3·分辨力：注入与权威相反的生效值必被逮', wrong !== null && wrongDrift.length > 0,
  wrong === null ? '服务起不来' : wrongDrift.length ? `逮到 ${wrongDrift.length} 槽分歧` : '注入错值却全一致——闸是摆设')

/* G4 归一单一来源（源码断言） */
const slotsSrc = readFileSync(join(ROOT, 'lib/companion/memory/memory-slots.mjs'), 'utf8')
const indexSrc = readFileSync(join(ROOT, 'lib/index.js'), 'utf8')
const insightSrc = readFileSync(join(ROOT, 'pet/standalone/apps/desktop/electron/insight.mjs'), 'utf8')
const hasExport = /export function effectiveSlotIds\s*\(/.test(slotsSrc)
const fnBody = /function activeMemorySlotIds\(\)\s*{[\s\S]*?\n}/.exec(indexSrc)?.[0] ?? ''
const indexCalls = fnBody.includes('effectiveSlotIds(')
const factBody = /async function buildFactSlots\(\)\s*{[\s\S]*?\n  }/.exec(insightSrc)?.[0] ?? ''
const insightDerived = factBody !== '' && !factBody.includes('enabled: slot.enabled') && factBody.includes('getActiveSlotIds')
push('G4·归一规则单一来源（memory-slots 导出 / index 调它 / 抽屉读注入值）',
  hasExport && indexCalls && insightDerived,
  `export=${hasExport} index调=${indexCalls} 抽屉派生=${insightDerived}`)

let bad = 0
for (const r of rows) {
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  ${r.detail}`)
  if (!r.ok) bad += 1
}
console.log(`[check-memory-slot-source] 共 ${rows.length} 条，红 ${bad} 条`)
console.log(`[END] script=check-memory-slot-source.mjs code=${bad > 0 ? 1 : 0}`)
process.exit(bad > 0 ? 1 : 0)
