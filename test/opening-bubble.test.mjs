import test from 'node:test'
import assert from 'node:assert/strict'

import { pickCue } from '../lib/companion/speak/opening.mjs'
import { bubbleTone } from '../lib/companion/voice-out/bubble-tone.mjs'

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2026, 10, 10, 6, 0, 0)

test('开口：空文本候选归「无候选不开口」，返回 null', () => {
  /* 只剩 reunion 一条由头，它的 text 为空；不能被抽中。 */
  const cue = pickCue({ now: T0, lastTalkAt: T0 - 9 * HOUR })
  assert.equal(cue, null)
})

test('开口：带文本的候选仍然正常返回', () => {
  const cue = pickCue({
    now: T0,
    agenda: [{ at: T0, text: '记得喝水' }],
  })
  assert.equal(cue?.kind, 'schedule')
  assert.equal(cue?.text, '记得喝水')
})

test('气泡语气词：右引号收尾的 note 原样返回，不落到引号外', () => {
  const note = '「我把窗户关好了」'
  assert.equal(bubbleTone(note, { warmth: 1 }), note)
})

test('气泡语气词：纯文本仍走旧后处理', () => {
  /* 同一句在引号外会得到语气词，证明上一条不是「什么都不改」。 */
  assert.equal(bubbleTone('我把窗户关好了', { warmth: 1 }), '我把窗户关好了呀')
})
