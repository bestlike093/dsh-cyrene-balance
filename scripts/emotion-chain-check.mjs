/**
 * 情绪链路自检：心情档位 → emotion → 渲染层。
 *
 * 只测主进程这一侧：currentMood() 会不会把余波/实验的结果正确带出去，
 * 以及决策失败时会不会把脸弄坏。
 *
 * 跑法：node scripts/emotion-chain-check.mjs
 */

import assert from 'node:assert/strict'
import { createPresenceService } from '../pet/standalone/apps/desktop/electron/presence.mjs'
import { createEmotionRuntime } from '../pet/standalone/apps/desktop/electron/emotion-runtime.mjs'

const MOOD_EMOTION = {
  calm: 'gentle',
  bright: 'happy',
  clingy: 'shy',
  sleepy: 'tired'
}

function createService(decideEmotion) {
  return createPresenceService({
    getSettings: () => ({}),
    getApiKey: async () => null,
    getMemoryDigest: () => null,
    getPersonaText: () => '',
    ...(decideEmotion === undefined ? {} : { decideEmotion }),
    now: () => new Date()
  })
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

check('不注入决策时按心情档位映射', () => {
  const mood = createService().currentMood()
  assert.ok(mood.level in MOOD_EMOTION, `未知档位 ${mood.level}`)
  assert.equal(mood.emotion, MOOD_EMOTION[mood.level])
})

check('实验组真的换了表情就采纳', () => {
  const mood = createService(() => ({ tag: 'surprised', group: 'experiment', changed: true })).currentMood()
  assert.equal(mood.emotion, 'surprised')
})

check('对照组 changed=false 时守住原情绪', () => {
  const service = createService((base) => ({ tag: 'neutral', group: 'control', changed: false, emotion: base }))
  const mood = service.currentMood()
  assert.equal(mood.emotion, MOOD_EMOTION[mood.level])
  assert.notEqual(mood.emotion, 'neutral')
})

check('开关关闭时守住原情绪', () => {
  const service = createService(() => ({ tag: 'neutral', group: 'off', changed: false }))
  const mood = service.currentMood()
  assert.equal(mood.emotion, MOOD_EMOTION[mood.level])
})

check('决策抛异常时不崩、守住原情绪', () => {
  const service = createService(() => {
    throw new Error('boom')
  })
  const mood = service.currentMood()
  assert.equal(mood.emotion, MOOD_EMOTION[mood.level])
})

check('决策返回空值时不污染情绪', () => {
  const service = createService(() => null)
  const mood = service.currentMood()
  assert.equal(mood.emotion, MOOD_EMOTION[mood.level])
})

check('旧字段没被破坏', () => {
  const mood = createService().currentMood()
  assert.equal(typeof mood.label, 'string')
  assert.equal(typeof mood.level, 'string')
})

/** 造一个打开了余波、实验组可指定的运行时。 */
function createRuntime({ afterglow = true, group = 'off' } = {}) {
  let clock = Date.UTC(2026, 10, 8, 9, 0, 0)
  const settings = {
    companion: {
      emotion: {
        afterglow: { enabled: afterglow, halfLifeMinutes: 30 },
        expression: { group }
      }
    }
  }
  const runtime = createEmotionRuntime({
    getSettings: () => settings,
    now: () => clock
  })
  return {
    runtime,
    advance: (ms) => {
      clock += ms
    }
  }
}

/**
 * 一次刺激的权重是 0.35，单句只到 0.175 —— 落在 neutral 带里。
 * 这是刻意的：不该一句话就换脸。要连续几句同调才累积出来。
 */
function chat(runtime, emotion, turns = 3) {
  for (let index = 0; index < turns; index += 1) runtime.noteUserTurn({ emotion })
}

check('余波在实验关闭时也能接管表情', () => {
  const { runtime } = createRuntime({ group: 'off' })
  chat(runtime, 'happy')
  const decided = runtime.decideExpression('neutral')
  assert.equal(decided.changed, true)
  assert.ok(['happy', 'excited'].includes(decided.tag), `拿到 ${decided.tag}`)
})

check('余波在对照组里同样生效', () => {
  const { runtime } = createRuntime({ group: 'control' })
  chat(runtime, 'sad')
  const decided = runtime.decideExpression('neutral')
  assert.equal(decided.changed, true)
  assert.equal(decided.tag, 'sad')
})

check('余波散尽后回到 neutral', () => {
  const { runtime, advance } = createRuntime({ group: 'off' })
  chat(runtime, 'happy')
  assert.equal(runtime.decideExpression('neutral').changed, true)
  // 半衰期 30 分钟，推 4 小时基本归零。
  advance(4 * 60 * 60 * 1000)
  const decided = runtime.decideExpression('neutral')
  assert.equal(decided.changed, false)
  assert.equal(decided.tag, 'neutral')
})

check('单句的话不会立刻换脸', () => {
  const { runtime } = createRuntime({ group: 'off' })
  runtime.noteUserTurn({ emotion: 'happy' })
  const decided = runtime.decideExpression('neutral')
  assert.equal(decided.changed, false)
})

check('有余波时也不覆盖这一轮的明确情绪', () => {
  const { runtime } = createRuntime({ group: 'off' })
  chat(runtime, 'happy')
  const decided = runtime.decideExpression('angry')
  assert.equal(decided.tag, 'angry')
  assert.equal(decided.changed, false)
})

check('余波关闭时完全不参与', () => {
  const { runtime } = createRuntime({ afterglow: false, group: 'off' })
  runtime.noteUserTurn({ emotion: 'happy' })
  const decided = runtime.decideExpression('neutral')
  assert.equal(decided.changed, false)
  assert.equal(decided.tag, 'neutral')
})

let failed = 0
for (const item of results) {
  if (item.ok) {
    console.log(`PASS  ${item.name}`)
  } else {
    failed += 1
    console.log(`FAIL  ${item.name}\n      ${item.error}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`)
if (failed > 0) process.exitCode = 1
