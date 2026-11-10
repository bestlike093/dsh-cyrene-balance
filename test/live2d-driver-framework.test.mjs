/**
 * live2d-driver（遐蝶桌宠驱动）表情/动作框架接入部分的单元测试。
 * 被测模块均带出处署名（见各文件头），只测行为，不测内部实现细节。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DRIVER_ACTION_MAP,
  resolveDriverActionKey,
  resolveNativeMotion
} from '../pet/standalone/apps/desktop/electron/renderer/action-name-map.mjs'
import {
  DRIVER_EMOJI_EXPRESSION,
  emojiToEmotion
} from '../pet/standalone/apps/desktop/electron/renderer/emoji-expression-map.mjs'
import {
  ZONE_BANDS,
  zoneAt,
  pickTouchReaction,
  TOUCH_REACTIONS
} from '../pet/standalone/apps/desktop/electron/renderer/touch-zones.mjs'
import { groupParamsByZone, describeCapability } from '../pet/standalone/apps/desktop/electron/renderer/capability-text.mjs'
import { createExpressionOverlay } from '../pet/standalone/apps/desktop/electron/renderer/expression-overlay.mjs'

// ---------------------------------------------------------------- 动作名映射

test('DRIVER_ACTION_MAP：9 条驱动原表，结构为 [动作组, 组内动作名]', () => {
  assert.equal(Object.keys(DRIVER_ACTION_MAP).length, 9)
  for (const [key, pair] of Object.entries(DRIVER_ACTION_MAP)) {
    assert.ok(Array.isArray(pair), `${key} 应为数组`)
    assert.equal(pair.length, 2, `${key} 应为 [组, 名]`)
  }
  assert.deepEqual(DRIVER_ACTION_MAP['点头'], ['小动作', '点头'])
  assert.deepEqual(DRIVER_ACTION_MAP['打瞌睡'], ['Sleep', null])
})

test('resolveDriverActionKey：中文动作名落到程序化 key', () => {
  assert.equal(resolveDriverActionKey('点头'), 'nod')
  assert.equal(resolveDriverActionKey('摇头'), 'shake')
  assert.equal(resolveDriverActionKey('张望'), 'look')
  assert.equal(resolveDriverActionKey('看过来'), 'look')
  assert.equal(resolveDriverActionKey('打瞌睡'), 'sleepyNod')
})

test('resolveDriverActionKey：不认识、空、非字符串一律 null，不猜', () => {
  assert.equal(resolveDriverActionKey('翻跟头'), null)
  assert.equal(resolveDriverActionKey(''), null)
  assert.equal(resolveDriverActionKey('   '), null)
  assert.equal(resolveDriverActionKey(null), null)
  assert.equal(resolveDriverActionKey(123), null)
})

test('resolveNativeMotion：精确命中优先，包含作为相近降级', () => {
  const cap = {
    native: [
      { group: 'Idle', index: 0, name: 'Sleep' },
      { group: 'Idle', index: 1, name: 'Tap Body' }
    ]
  }
  const exact = resolveNativeMotion(cap, 'Sleep')
  assert.equal(exact.name, 'Sleep')
  assert.equal(exact.group, 'Idle')
  const near = resolveNativeMotion(cap, 'sleep')
  assert.equal(near.name, 'Sleep')
  const dash = resolveNativeMotion(cap, 'tap_body')
  assert.equal(dash.name, 'Tap Body')
})

test('resolveNativeMotion：没有对得上的返回 null', () => {
  const cap = { native: [{ group: 'Idle', index: 0, name: 'Sleep' }] }
  assert.equal(resolveNativeMotion(cap, '翻跟头'), null)
  assert.equal(resolveNativeMotion({ native: [] }, 'Sleep'), null)
  assert.equal(resolveNativeMotion(null, 'Sleep'), null)
  assert.equal(resolveNativeMotion(cap, ''), null)
})

// ---------------------------------------------------------------- emoji → 表情

test('DRIVER_EMOJI_EXPRESSION：驱动原表保留 21 条', () => {
  assert.equal(Object.keys(DRIVER_EMOJI_EXPRESSION).length, 21)
})

test('emojiToEmotion：驱动贴纸 id 折到 dsh-pet 情绪 tag', () => {
  assert.equal(emojiToEmotion('xd-shy'), 'shy') // 016脸红 → shy
  assert.equal(emojiToEmotion('xd-angry'), 'angry') // 009生气 → angry
  assert.equal(emojiToEmotion('xd-sad'), 'sad') // 015泪光 → sad
  assert.equal(emojiToEmotion('xd-happy'), 'excited') // 013星星眼 → excited
  assert.equal(emojiToEmotion('xd-sleepy'), 'tired') // 019ZZZ → tired
  assert.equal(emojiToEmotion('thinking'), 'thinking') // 012O.O → thinking
})

test('emojiToEmotion：我们素材表的情绪名 id 直通', () => {
  assert.equal(emojiToEmotion('happy'), 'happy')
  assert.equal(emojiToEmotion('shy'), 'shy')
  assert.equal(emojiToEmotion('excited'), 'excited')
})

test('emojiToEmotion：没映射的贴纸不动脸', () => {
  assert.equal(emojiToEmotion('cy-happy'), null)
  assert.equal(emojiToEmotion('mystery-sticker'), null)
  assert.equal(emojiToEmotion(''), null)
  assert.equal(emojiToEmotion(null), null)
})

// ---------------------------------------------------------------- 七段触摸

test('ZONE_BANDS：七段分区比例照驱动原样', () => {
  assert.deepEqual(
    ZONE_BANDS.map((b) => b.id),
    ['head', 'face', 'shoulder', 'chest', 'waist', 'skirt', 'foot']
  )
  assert.equal(ZONE_BANDS[0].until, 0.5)
  assert.equal(ZONE_BANDS[6].until, 1.01)
})

test('zoneAt：按相对高度分段，越界钳到首尾', () => {
  const bounds = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(zoneAt(bounds, 50, 20).zone, 'head') // y=0.2 < 0.5
  assert.equal(zoneAt(bounds, 50, 60).zone, 'face') // 0.5 ≤ 0.6 < 0.67
  assert.equal(zoneAt(bounds, 50, 70).zone, 'shoulder') // 0.67 ≤ 0.7 < 0.73
  assert.equal(zoneAt(bounds, 50, 75).zone, 'chest')
  assert.equal(zoneAt(bounds, 50, 82).zone, 'waist')
  assert.equal(zoneAt(bounds, 50, 92).zone, 'skirt')
  assert.equal(zoneAt(bounds, 50, 98).zone, 'foot')
  // 越界：上面钳到 head，下面钳到 foot
  assert.equal(zoneAt(bounds, 50, -10).zone, 'head')
  assert.equal(zoneAt(bounds, 50, 999).zone, 'foot')
})

test('zoneAt：bounds 带偏移时先减 x/y 再算比例', () => {
  const bounds = { x: 100, y: 200, width: 200, height: 400 }
  const hit = zoneAt(bounds, 200, 400) // relX=0.5, relY=0.5 → face 边缘
  assert.equal(hit.zone, 'face')
  assert.equal(hit.relX, 0.5)
  assert.equal(hit.relY, 0.5)
})

test('pickTouchReaction：固定随机源时结果确定，未知部位回落到 chest', () => {
  const headPick = pickTouchReaction('head', () => 0.99)
  assert.equal(headPick.zone, 'head')
  assert.equal(headPick.motion, 'tilt')
  assert.equal(typeof headPick.line, 'string')
  assert.ok(headPick.line.length > 0)
  // random=0.99 → index 2（最后一条）
  assert.equal(headPick.line, TOUCH_REACTIONS.head[2].line)
  const chestPick = pickTouchReaction('nonsense-zone', () => 0)
  assert.equal(chestPick.zone, 'chest')
  assert.equal(chestPick.line, TOUCH_REACTIONS.chest[0].line)
})

test('TOUCH_REACTIONS：七部位都有反应库，情绪是十情绪之一', () => {
  const tags = ['shy', 'excited', 'sad', 'thinking']
  for (const zone of Object.keys(TOUCH_REACTIONS)) {
    const list = TOUCH_REACTIONS[zone]
    assert.equal(list.length, 3, `${zone} 应有 3 条`)
    for (const item of list) {
      assert.ok(tags.includes(item.emotion), `${zone} 的情绪 ${item.emotion} 未知`)
      assert.equal(typeof item.motion, 'string')
    }
  }
})

// ---------------------------------------------------------------- 能力成文

test('groupParamsByZone：Cubism 参数 id 归到对应部位', () => {
  const grouped = groupParamsByZone([
    'ParamEyeLOpen',
    'ParamEyeBallX',
    'ParamBrowLY',
    'ParamMouthOpenY',
    'ParamCheek',
    'ParamAngleX',
    'ParamAngleZ',
    'ParamBodyAngleX',
    'ParamArmL',
    'ParamLegL',
    'ParamHairFront',
    'ParamBreath',
    'SomeCustomParam'
  ])
  assert.deepEqual(grouped.eyes, ['ParamEyeLOpen'])
  assert.deepEqual(grouped.eyeBall, ['ParamEyeBallX'])
  assert.deepEqual(grouped.brows, ['ParamBrowLY'])
  assert.deepEqual(grouped.mouth, ['ParamMouthOpenY'])
  assert.deepEqual(grouped.cheeks, ['ParamCheek'])
  assert.deepEqual(grouped.head, ['ParamAngleX', 'ParamAngleZ'])
  assert.deepEqual(grouped.body, ['ParamBodyAngleX'])
  assert.deepEqual(grouped.arms, ['ParamArmL'])
  assert.deepEqual(grouped.legs, ['ParamLegL'])
  assert.deepEqual(grouped.hair, ['ParamHairFront'])
  assert.deepEqual(grouped.breath, ['ParamBreath'])
  assert.deepEqual(grouped.unknown, ['SomeCustomParam'])
})

test('describeCapability：全空时 Lv.1，明说做不到', () => {
  const text = describeCapability({})
  assert.equal(text.level, 1)
  assert.equal(text.levelLabel, '很少')
  assert.equal(text.can.length, 0)
  assert.ok(text.cannot.includes('播放现成动作'))
  assert.ok(text.cannot.includes('切换现成表情'))
})

test('describeCapability：自带表情+动作+参数都有时升档', () => {
  const motionCapability = {
    native: [
      { group: 'Idle', index: 0, name: 'Sleep' },
      { group: 'Idle', index: 1, name: 'Tap Body' }
    ],
    param: [
      'ParamEyeLOpen',
      'ParamEyeBallX',
      'ParamEyeBallY',
      'ParamBrowLY',
      'ParamMouthOpenY',
      'ParamCheek',
      'ParamAngleX',
      'ParamAngleZ',
      'ParamBodyAngleX',
      'ParamArmL',
      'ParamLegL',
      'ParamHairFront',
      'ParamBreath'
    ]
  }
  const expressionCapability = {
    nativeExpressions: ['开心', '难过', '生气', '惊讶']
  }
  const text = describeCapability({ motionCapability, expressionCapability })
  // 计分：表情 1+1（≥4 种）、动作 1、eyes 1、brows+mouth 1、cheeks 1、
  // head≥2 1、body 1、arms 1、legs 1、hair 1、breath 1 = 12 → Lv.5
  assert.equal(text.score, 12)
  assert.equal(text.level, 5)
  assert.equal(text.levelLabel, '很丰富')
  assert.ok(text.can.some((line) => line.includes('换 4 种自带表情')))
  assert.ok(text.can.some((line) => line.includes('视线看向指定方向')))
  assert.ok(text.derived.includes('皱眉抿嘴（生气、难过）'))
  assert.deepEqual(text.cannot, [])
})

test('describeCapability：只报能拼的参数姿态，motions 只有名字', () => {
  const text = describeCapability({
    motionCapability: {
      native: [{ group: '小动作', index: 0, name: '点头' }],
      param: ['ParamAngleX', 'ParamAngleZ', 'ParamMouthOpenY']
    },
    expressionCapability: null
  })
  assert.deepEqual(text.motions, ['点头'])
  // 计分：动作 1 分 + 头部两轴 1 分 = 2；单 mouth 不单独计分（要 brows+mouth 组合才计）
  assert.equal(text.score, 2)
  assert.equal(text.level, 1)
  assert.equal(text.levelLabel, '很少')
  assert.ok(text.derived.includes('点头 / 摇头 / 歪头（用头部三轴压出来）'))
  assert.ok(text.cannot.includes('切换现成表情'))
})

// ---------------------------------------------------------------- 表情覆盖回落

test('setTemporary：盖临时脸，到期按墙钟回中性', () => {
  let clock = 0
  const calls = []
  const fakeTicker = {
    add(handler) {
      this.handler = handler
    },
    remove(handler) {
      if (this.handler === handler) this.handler = null
    }
  }
  const expression = {
    apply: (tag, meta) => {
      calls.push(['apply', tag, meta.source])
      return { ok: true, tag, channel: 'param' }
    },
    reset: (meta) => {
      calls.push(['reset', meta.source])
    }
  }
  const overlay = createExpressionOverlay({
    expression,
    ticker: fakeTicker,
    now: () => clock
  })

  assert.equal(overlay.setTemporary('shy', 30000).ok, true)
  assert.equal(overlay.snapshot().deadline, 30000)
  assert.deepEqual(calls[0], ['apply', 'shy', 'overlay'])

  // 没到点：不动
  clock = 29999
  fakeTicker.handler()
  assert.equal(calls.length, 1)

  // 到点：墙钟对时，一帧内回中性（模拟睡眠后醒来时钟直接跳过）
  clock = 60000
  fakeTicker.handler()
  assert.deepEqual(calls[1], ['reset', 'overlay-expired'])
  assert.equal(overlay.snapshot().deadline, 0)
  // 到期后 handler 已从 ticker 摘除
  assert.equal(fakeTicker.handler, null)
})

test('setTemporary：控制器不支持该情绪时如实返回，不设截止时间', () => {
  const overlay = createExpressionOverlay({
    expression: {
      apply: () => ({ ok: false, reason: 'unsupported' }),
      reset: () => {}
    },
    now: () => 0
  })
  const result = overlay.setTemporary('angry', 30000)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsupported')
  assert.equal(overlay.snapshot().deadline, 0)
})

test('cancel：立刻收掉，不触发 reset 事件', () => {
  const calls = []
  const ticker = { add: () => {}, remove: () => {} }
  const overlay = createExpressionOverlay({
    expression: {
      apply: () => {
        calls.push('apply')
        return { ok: true, tag: 'shy', channel: 'param' }
      },
      reset: () => calls.push('reset')
    },
    ticker,
    now: () => 0
  })
  overlay.setTemporary('shy', 30000)
  overlay.cancel()
  assert.equal(overlay.snapshot().deadline, 0)
  assert.deepEqual(calls, ['apply']) // 没有 reset
})

test('无 expression 时不炸，返回 no-expression', () => {
  const overlay = createExpressionOverlay({ now: () => 0 })
  assert.deepEqual(overlay.setTemporary('shy'), { ok: false, reason: 'no-expression' })
})
