#!/usr/bin/env node
/**
 * check-override-sticky.mjs —— override 粘住层闸（P1-b 结构半 · 断言②载体）
 *
 * 断言②「人工粘住后自动值不得写回档位，直到显式交还」的执法：
 *  S1 静态：applyBondEvent 的 stageKey 写回行必须带 affinityLocked 卫兵；
 *  S2 行为：先定档 → 粘住 → 大事件 → stageKey 纹丝不动（对照组同事件必须推得动，
 *      对照组不动=fixture 无推力，实验组作废不充绿）；
 *  S3 交还：解锁后连给大事件，档位恢复更新（锁不许变永久砖）；
 *  S4 账不冻：粘住期间其他维度照常记账（钉的是档，不是整本账）；
 *  S5 衰减面：decayBond 长放不改 stageKey（衰减算账不算档）。
 *
 * 首跑预期：S1/S2b 红——现网 :702 无卫兵、锁只护 affinity 单维（断言②证红）。
 * 用法：node scripts/check-override-sticky.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results = []
const put = (name, ok, got) => results.push({ name, ok, got: String(got ?? '') })

const { defaultBond, normalizeBond, setAffinityLocked, applyBondEvent, decayBond } =
  await import(pathToFileURL(path.join(ROOT, 'lib/companion/state/bond.mjs')).href)

// ---- S1 静态卫兵 ----
{
  const src = fs.readFileSync(path.join(ROOT, 'lib/companion/state/bond.mjs'), 'utf8')
  const lines = src.replace(/\r/g, '').split('\n')
  // 刀④后形状：块状卫兵 if(locked!==true){ stage=…; verdict=…; if(ok||!ENFORCE) next.stageKey=stage.key }
  const blockStart = lines.findIndex((l) => /^\s*if \(next\.affinityLocked !== true\) \{/.test(l))
  const blockHasWrite = blockStart > 0 && lines.slice(blockStart, blockStart + 14).some((l) => /next\.stageKey = stage\.key/.test(l))
  const oneLine = lines.findIndex((l) => /^\s*if \(next\.affinityLocked !== true\) next\.stageKey\s*=/.test(l))
  const guarded = blockHasWrite || oneLine > 0
  const writeIdx = blockStart > 0 ? blockStart : oneLine
  put('S1 stageKey 写回路径受 affinityLocked 卫兵（单行/块状）', writeIdx > 0 && guarded,
    writeIdx < 0 ? '未找到写回行（形状变了，人来核）' : `:${writeIdx + 1} ${guarded ? '已护（块状卫兵在位）' : '裸写无护=档位会绕过粘住'}`)
}

// ---- S2/S3/S4 行为三幕 ----
{
  const DAY = 86400000
  const t0 = Date.UTC(2026, 8, 1, 4, 0, 0)
  const mk = () => normalizeBond(defaultBond(t0, 'owner', 'sticky-fixture-seed'), t0)

  const { bondLevel } = await import(pathToFileURL(path.join(ROOT, 'lib/companion/state/bond.mjs')).href)

  // 前奏：+70/72d 双连 moment 堆到 attached（下行推力要破 attached−10 的滞回线，
  // 一轮不够就加密裂口系列；score 一并出口，调参不靠猜）
  const pre0 = applyBondEvent(mk(), { type: 'shareSecret', amount: 3 }, { now: t0 + 70 * DAY }).bond
  const pre = applyBondEvent(pre0, { type: 'promise', amount: 3 }, { now: t0 + 72 * DAY }).bond
  const stageAfterPre = pre.stageKey

  const hammer = async (base, tStart) => {
    let b = base
    for (let i = 0; i < 6; i++) b = applyBondEvent(b, { type: 'betray', amount: 3 }, { now: tStart + i * 2 * DAY }).bond
    for (let i = 0; i < 3; i++) b = applyBondEvent(b, { type: 'harshWords', amount: 3 }, { now: tStart + (13 + i * 2) * DAY }).bond
    return b
  }

  // 对照组：不锁，裂口九连——档位必须跌得动（fixture 推力自证）
  const c1 = await hammer(pre, t0 + 74 * DAY)
  const controlMoves = c1.stageKey !== stageAfterPre
  put('S2a 对照组：未锁裂口九连推力成立', controlMoves, `stageKey ${stageAfterPre} → ${c1.stageKey}（score ${bondLevel(pre)}→${bondLevel(c1)}，affinity ${pre.affinity}→${c1.affinity}）`)

  // 实验组：定档 → 粘住 → 同序九连——档位必须纹丝不动，账照记
  const l0 = setAffinityLocked(pre, true, t0 + 73 * DAY)
  const l1 = await hammer(l0, t0 + 74 * DAY)
  put('S2b 粘住后档位纹丝不动（断言②主案）', controlMoves ? l1.stageKey === stageAfterPre : false,
    controlMoves ? `粘住档=${stageAfterPre} 九连后=${l1.stageKey}（score 已到 ${bondLevel(l1)}）` : '对照组无推力，本条作废不充绿')

  // S4：粘住期间账照动（betray/harshWords 真实记账；affinity 单维被护）
  put('S4 钉档不冻账：粘住期间 trust 仍记、affinity 单维仍护',
    l1.trust < l0.trust && l1.affinity === l0.affinity, `trust ${l0.trust}→${l1.trust}，affinity ${l0.affinity}→${l1.affinity}（后者应不变）`)

  // S3：显式交还后恢复更新（解锁再一记重话，档位应立刻跟账）
  const l2 = setAffinityLocked(l1, false, t0 + 90 * DAY)
  const l3 = applyBondEvent(l2, { type: 'harshWords', amount: 3 }, { now: t0 + 91 * DAY }).bond
  put('S3 交还后档位恢复更新（锁不是永久砖）', controlMoves ? l3.stageKey !== stageAfterPre : false,
    `交还后一记重话：stageKey ${stageAfterPre} → ${l3.stageKey}（score ${bondLevel(l3)}）`)
}

// ---- S5 衰减面 ----
{
  const t0 = Date.UTC(2026, 10, 10, 4, 0, 0)
  const DAY = 86400000
  const b = applyBondEvent(normalizeBond(defaultBond(t0, 'owner', 'decay-seed'), t0), { type: 'shareSecret', amount: 3 }, { now: t0 + 10 * DAY }).bond
  const locked = setAffinityLocked(b, true, t0 + 10 * DAY)
  const before = locked.stageKey
  const after = decayBond(locked, t0 + 100 * DAY)
  put('S5 长放衰减不动档（衰减算账不算档）', after.stageKey === before, `stageKey ${before} → ${after.stageKey}`)
}

let fail = 0
for (const r of results) {
  if (!r.ok) fail += 1
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  → ${r.got.slice(0, 150)}`)
}
console.log(`[check-override-sticky] 共 ${results.length} 条，红 ${fail} 条`)
console.log('[END] script=check-override-sticky code=' + (fail ? 1 : 0))
process.exit(fail ? 1 : 0)
