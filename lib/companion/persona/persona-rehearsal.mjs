/**
 * 人格试演：给一组状态，输出她这一轮会看到的「此刻」段落和分档结论。
 *
 * 只读、无副作用。给三件事用：
 * - 手工对照：改了阈值以后，各档位到底长什么样
 * - 回归测试：同一组输入，输出不该悄悄漂掉
 * - 以后接设置页的预览按钮（现在只有模块，没接 UI）
 *
 * 试演不构造 bond，关系档直接取 relationship-stage 的权威表；
 * 要验「有 bond 时优先」的分支，给场景带上 bond 即可。
 */

import { pathToFileURL } from 'node:url'

import { resolveRelationStage } from '../state/relationship-stage.mjs'
import { bodyBandOf, frictionBandOf } from '../state/snapshot.mjs'
import { buildNowPrompt } from './persona.mjs'

const DAY = 24 * 60 * 60 * 1000

/* 只给最少的状态，其余走默认，免得试演结果被无关输入带偏。 */
export const REHEARSAL_SCENARIOS = [
  { key: 'first_meet', name: '刚认识', score: 5, daysKnown: 0, energy: 70, irritation: 0 },
  { key: 'acquainted', name: '认识一阵了', score: 25, daysKnown: 10, energy: 65, irritation: 0 },
  { key: 'familiar', name: '熟起来了', score: 50, daysKnown: 40, energy: 60, irritation: 0 },
  { key: 'close', name: '很亲近', score: 80, daysKnown: 120, energy: 55, irritation: 0 },
  { key: 'tired', name: '累了', score: 80, daysKnown: 120, energy: 30, irritation: 0 },
  { key: 'annoyed', name: '有点烦', score: 60, daysKnown: 60, energy: 50, irritation: 80 },
  { key: 'soothed', name: '刚被哄过', score: 60, daysKnown: 60, energy: 50, irritation: 35 },
]

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 试演一个场景。返回结论与提示词，不写任何状态。 */
export function rehearse(scenario = {}, { locale = 'zh-CN', now = Date.now() } = {}) {
  const days = Math.max(0, num(scenario.daysKnown, 0))
  const score = Math.max(0, Math.min(100, num(scenario.score, 0)))
  const energy = Math.max(0, Math.min(100, num(scenario.energy, 78)))
  const irritation = Math.max(0, num(scenario.irritation, 0))
  const firstMetAt = now - days * DAY

  const relation = resolveRelationStage({ score, firstMetAt, now })
  const body = bodyBandOf(energy)
  const friction = frictionBandOf(irritation, scenario.tolerance)

  /* 传同一个 relation 进去：提示词里那句「对眼前这个人」和上面那行必须一致。 */
  const nowPrompt = buildNowPrompt(
    {
      mood: scenario.mood,
      affinity: Number.isFinite(Number(scenario.affinity)) ? Number(scenario.affinity) : score,
      stage: relation,
      energy,
      irritation,
      frictionTolerance: scenario.tolerance,
    },
    locale,
  )

  return {
    key: String(scenario.key ?? ''),
    name: String(scenario.name ?? scenario.key ?? ''),
    input: { score, daysKnown: days, energy, irritation },
    relation: {
      key: relation.key,
      label: relation.label,
      tone: relation.tone,
      next: relation.next,
    },
    body: { key: body.key, label: body.label },
    friction: { key: friction.key, label: friction.label },
    nowPrompt,
  }
}

/** 批量试演，默认跑内置场景表。 */
export function runRehearsal({ scenarios = REHEARSAL_SCENARIOS, locale = 'zh-CN', now = Date.now() } = {}) {
  return scenarios.map((item) => rehearse(item, { locale, now }))
}

/** 排版成能直接看的对照表。 */
export function formatRehearsal(results) {
  const lines = []
  for (const item of results) {
    const gap = item.relation.next
      ? ` → ${item.relation.next.label}（好感还差 ${item.relation.next.needScore}，天数还差 ${item.relation.next.needDays}）`
      : ''
    lines.push(
      `${item.name}｜关系 ${item.relation.label}（${item.relation.key}）／精力 ${item.body.label}／摩擦 ${item.friction.label}${gap}`,
    )
  }
  return lines.join('\n')
}

/* 直接跑：node lib/companion/persona-rehearsal.mjs */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const locale = process.argv.includes('--en') ? 'en-US' : 'zh-CN'
  const results = runRehearsal({ locale })
  console.log(formatRehearsal(results))
  console.log('')
  for (const item of results) {
    console.log(`--- ${item.name} ---`)
    console.log(item.nowPrompt)
    console.log('')
  }
}
