import { deriveTraits, nostalgiaBias, nostalgiaDetail } from '../lib/companion/persona/traits.mjs'
import { weightOf } from '../lib/companion/memory/memory-store.mjs'
import { pickCue } from '../lib/companion/speak/opening.mjs'

const DAY = 86_400_000
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log('ok   ', name, detail)
  else { fail += 1; console.log('FAIL ', name, detail) }
}

/* 1. 值域与 clamp */
const maxPos = nostalgiaBias('记得'.repeat(80))
const maxNeg = nostalgiaBias('不记得'.repeat(80))
ok('全正向 <= 1', maxPos <= 1, String(maxPos))
ok('全负向 >= -1', maxNeg >= -1, String(maxNeg))

/* 2. 归一常数不依赖词数 */
ok('单命中 0.5', Math.abs(nostalgiaBias('记得') - 0.5) < 1e-9, String(nostalgiaBias('记得')))

/* 3. 否定前缀 */
ok('「不记得」为负', nostalgiaBias('不记得') < 0, String(nostalgiaBias('不记得')))
ok('「从不回望」为负', nostalgiaBias('从不回望') < 0, String(nostalgiaBias('从不回望')))
ok('「不必记得」不翻正', nostalgiaBias('不必记得') > 0, String(nostalgiaBias('不必记得')))

/* 4. 空文本与 deriveTraits 默认 */
ok('空文本 0', nostalgiaBias('') === 0)
ok('deriveTraits 空文本 recallBias 0', deriveTraits('').recallBias === 0)

const seven = '哀丽秘榭。她记得多少说多少，记不清就说记不清。舍不得，也愿意等。陪伴、记录、走过漫长的路。回望过往，涟漪久久不散。会记得对方提过的小事。'
const d7 = deriveTraits(seven)
console.log('     七段样例 recallBias =', d7.recallBias, 'hits =', Object.keys(d7.hits).join(','))
ok('七段样例落在 [-1,1]', d7.recallBias >= -1 && d7.recallBias <= 1, String(d7.recallBias))

/* 4a. 念旧样例逐词明细：0.90 的账要对得平 */
const sevenDetail = nostalgiaDetail(seven)
console.log('     —— 念旧样例明细 ——')
console.log(`     pos=${sevenDetail.pos.toFixed(3)}  neg=${sevenDetail.neg.toFixed(3)}`)
for (const hit of sevenDetail.hits) {
  console.log(`       ${hit.side === 'pos' ? '+' : '−'} ${hit.word} ×${hit.count}`)
}

/* 4b. 跨角色分布：同一套词集喂几种人设，看 bias 是散开还是全挤在正端 */
const profiles = [
  { name: '念旧', text: seven },
  {
    name: '向前看',
    text: '她习惯翻篇。过去的事就让它过去，不回头，不沉溺，往前走。明天比昨天重要。',
  },
  {
    name: '中性',
    text: '她说话简短，不主动找人，也不拒绝。喜欢安静，做事有分寸。',
  },
  {
    name: '温柔回归',
    text: '她柔软、细腻、容易被打动，会认真听你说话，也会在你难过时递来一杯温水。',
  },
  {
    /*
     * 验收样例，预期 bias=0.67 / 33.06 天。
     * 「珍惜」「眷恋」握的是已发生的事，本来就该比纯关系词更念旧；
     * 这是正确输出，不是回归失败，别为了压回 0 去动词表或加权重分层。
     */
    name: '温柔含珍惜',
    text: '她柔软、细腻，珍惜每一次相遇，也眷恋那些温暖的片刻。',
  },
  {
    name: '混合',
    text: '她舍不得那些旧日子，也会记得你说过的小事；但她不回头，习惯往前走。',
  },
]
const halfLifeOf = (bias) =>
  30 * (1 + (Math.sign(bias) * Math.max(0, Math.abs(bias) - 0.15)) / 0.85 / 6)
console.log('\n     —— 跨角色分布 ——')
for (const p of profiles) {
  const d = deriveTraits(p.text)
  console.log(
    `     ${p.name.padEnd(5, '　')} bias=${d.recallBias.toFixed(2).padStart(5)}  halfLife=${halfLifeOf(d.recallBias).toFixed(2)} 天`,
  )
}
const spread = profiles.map((p) => deriveTraits(p.text).recallBias)
const hasNegative = spread.some((value) => value < 0)
const hasNeutral = spread.some((value) => value === 0)
console.log(`     负端可达=${hasNegative}  零点可见=${hasNeutral}\n`)

/* 4c. 混合样例逐词明细：0 分必须有账可对 */
const mixProfile = profiles.find((p) => p.name === '混合')
const mixDetail = nostalgiaDetail(mixProfile.text)
console.log('     —— 混合明细 ——')
console.log(`     text: ${mixProfile.text}`)
console.log(`     pos=${mixDetail.pos.toFixed(3)}  neg=${mixDetail.neg.toFixed(3)}`)
for (const hit of mixDetail.hits) {
  console.log(`       ${hit.side === 'pos' ? '+' : '−'} ${hit.word} ×${hit.count}`)
}
ok(
  '混合的 0 分能对上账（正负抵消）',
  Math.abs(mixDetail.pos - mixDetail.neg) < 1e-9,
  `pos=${mixDetail.pos} neg=${mixDetail.neg}`,
)

/* 4d. 温柔回归：关系词移出后，不含记忆词的温柔型必须仍为 0 */
const gentle = deriveTraits(profiles.find((p) => p.name === '温柔回归').text)
ok('温柔型（无记忆词）必须为 0', gentle.recallBias === 0, String(gentle.recallBias))

/* 4e. 边界：只写「珍惜 / 眷恋」时会不会又漂回正端 */
const cherishProfile = profiles.find((p) => p.name === '温柔含珍惜')
const cherishDetail = nostalgiaDetail(cherishProfile.text)
const cherishBias = deriveTraits(cherishProfile.text).recallBias
console.log(
  `     温柔含珍惜：pos=${cherishDetail.pos.toFixed(3)} neg=${cherishDetail.neg.toFixed(3)} → bias=${cherishBias.toFixed(2)} / ${halfLifeOf(cherishBias).toFixed(2)} 天\n`,
)

/*
 * 验收样例拆两段断言，让红色自己说明原因：
 *   A 红 → 措辞变了（珍惜写成珍重）或词表词形被换；
 *   A 绿、B 红 → 公式被动过。
 */
const cherishHits = cherishDetail.hits.map((hit) => `${hit.word}×${hit.count}${hit.side}`)
ok(
  '温柔含珍惜 命中结构',
  JSON.stringify(cherishHits) === JSON.stringify(['珍惜×1pos', '眷恋×1pos']),
  cherishHits.join('、') || '无命中',
)

/* 由 hits 独立复算一遍，不走 core 的公式。 */
const softenOf = (n) => (n === 0 ? 0 : 1 + Math.min(2, n - 1) / 3)
const posFromHits = cherishDetail.hits
  .filter((hit) => hit.side === 'pos')
  .reduce((sum, hit) => sum + softenOf(hit.count), 0)
const negFromHits = cherishDetail.hits
  .filter((hit) => hit.side === 'neg')
  .reduce((sum, hit) => sum + softenOf(hit.count), 0)
const biasFromHits = Math.round(((posFromHits - negFromHits) / (posFromHits + negFromHits + 1)) * 100) / 100
ok('温柔含珍惜 由 hits 复算 = 0.67', biasFromHits === 0.67, String(biasFromHits))
ok('deriveTraits 与复算一致', cherishBias === biasFromHits, `${cherishBias} / ${biasFromHits}`)

/* 5. bias=0 与旧公式逐值一致 */
const oldWeight = (item, now) => {
  if (item.pinned) return 1
  const mentions = Math.max(1, Math.trunc(Number(item.mentions) || 1))
  const mentionScore = 1 - Math.exp(-mentions / 3)
  const ageDays = Math.max(0, (now - Number(item.lastAt || item.at || now)) / DAY)
  const recency = Math.pow(0.5, ageDays / 30)
  return Number((0.55 * mentionScore + 0.45 * recency).toFixed(4))
}
const now = Date.UTC(2026, 10, 10)
let same = true
for (const age of [0, 1, 7, 30, 90, 365]) {
  for (const mentions of [1, 2, 3, 5]) {
    const item = { mentions, lastAt: now - age * DAY }
    if (weightOf(item, now, 0) !== oldWeight(item, now)) {
      same = false
      console.log('     diff', age, mentions, weightOf(item, now, 0), oldWeight(item, now))
    }
  }
}
ok('bias=0 与旧公式逐值一致', same)

/* 6. 半衰期 25 / 35 天 */
const recencyOf = (bias, age) => {
  const w = weightOf({ mentions: 1, lastAt: now - age * DAY }, now, bias)
  return (w - 0.55 * (1 - Math.exp(-1 / 3))) / 0.45
}
const rPos = recencyOf(1, 30)
const rNeg = recencyOf(-1, 30)
ok('bias=1 在 30 天 ≈ 0.5^(30/35)', Math.abs(rPos - Math.pow(0.5, 30 / 35)) < 1e-3, rPos.toFixed(4))
ok('bias=-1 在 30 天 ≈ 0.5^(30/25)', Math.abs(rNeg - Math.pow(0.5, 30 / 25)) < 1e-3, rNeg.toFixed(4))

/* 7. 死区连续 */
const item20 = { mentions: 2, lastAt: now - 20 * DAY }
ok('bias=0.15 与 0 完全相等', weightOf(item20, now, 0.15) === weightOf(item20, now, 0))

/* 8. age 0~90：新/旧记忆交叉年龄随 bias 漂移 */
const heavy = { mentions: 3, lastAt: now - 60 * DAY }
const crossover = (bias) => {
  let lo = 0
  let hi = 90
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2
    const wNew = weightOf({ mentions: 1, lastAt: now - mid * DAY }, now, bias)
    const wHeavy = weightOf(heavy, now, bias)
    if (wNew > wHeavy) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
const c0 = crossover(0)
const cp = crossover(1)
const cn = crossover(-1)
console.log('     交叉年龄 bias=-1/0/+1 =', cn.toFixed(2), c0.toFixed(2), cp.toFixed(2), '天')
ok('负 bias 让旧记忆掉得更快（交叉点更远）', cn > c0, `${cn.toFixed(2)} > ${c0.toFixed(2)}`)
ok('正 bias 让旧记忆更耐放（交叉点更近）', cp < c0, `${cp.toFixed(2)} < ${c0.toFixed(2)}`)
ok('漂移落在 ±5 天量级', Math.abs(cp - c0) < 12 && Math.abs(c0 - cn) < 12)

/* 9. never 在 ±0.8 两端都不出现 */
const memories = [
  { text: '普通的旧事', weight: 0.7, key: 'plain', mentionPolicy: 'soft_echo' },
  { text: '绝不该提的事', weight: 0.99, key: 'never', mentionPolicy: 'never' },
]
let leaked = 0
let memoryPicked = 0
for (let i = 0; i < 300; i += 1) {
  const at = now + i * DAY
  const cue = pickCue({
    now: at,
    memories,
    lastTalkAt: at - 5 * DAY,
    ledger: null,
    options: { dailyCap: 99, minGapMs: 0, silenceDays: 30, unansweredLimit: 99 },
  })
  if (cue === null) continue
  if (cue.kind === 'memory' || cue.text !== undefined) {
    memoryPicked += 1
    if (cue.key === 'never' || String(cue.text ?? '').includes('绝不该')) leaked += 1
  }
}
ok('never 一次也没被抽中', leaked === 0, `memory 抽中 ${memoryPicked} 次，泄漏 ${leaked} 次`)

console.log(fail === 0 ? '\nALL_PASS' : `\nFAILED ${fail}`)
process.exit(fail === 0 ? 0 : 1)
