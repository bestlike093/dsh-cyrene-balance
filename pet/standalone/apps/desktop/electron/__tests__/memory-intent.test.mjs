import { describe, expect, it } from 'vitest'
import {
  MEMORY_INTENTS,
  classifyMemoryIntent,
  describeRecallPlan,
  memoryRecallPlan,
  planMemoryRecall
} from '../memory-intent.mjs'

describe('classifyMemoryIntent', () => {
  it('问当下状态时收窄窗口', () => {
    expect(classifyMemoryIntent('你在干嘛呢').intent).toBe('current_state')
    expect(classifyMemoryIntent('今天过得怎么样').intent).toBe('current_state')
  })

  it('一声应答算低信息', () => {
    expect(classifyMemoryIntent('嗯嗯').intent).toBe('low_info')
    expect(classifyMemoryIntent('在吗').intent).toBe('low_info')
    expect(classifyMemoryIntent('').intent).toBe('low_info')
  })

  it('承接的话只看最近上下文', () => {
    expect(classifyMemoryIntent('继续').intent).toBe('recent_context')
    expect(classifyMemoryIntent('然后呢').intent).toBe('recent_context')
  })

  it('限定时间范围时要放宽窗口', () => {
    expect(classifyMemoryIntent('上周那个事怎么样了').intent).toBe('time_window')
    expect(classifyMemoryIntent('前天说的那个').intent).toBe('time_window')
  })

  it('纠错优先级最高', () => {
    expect(classifyMemoryIntent('你记错了，我说的是周三').intent).toBe('correction')
    expect(classifyMemoryIntent('我没说过这种话').intent).toBe('correction')
  })

  it('翻旧账时窗口最大', () => {
    expect(classifyMemoryIntent('你还记得我们第一次见面吗').intent).toBe('long_term')
  })

  it('普通闲聊走默认', () => {
    expect(classifyMemoryIntent('今天好累').intent).toBe('recent_topic')
  })
})

describe('planMemoryRecall', () => {
  it('当下状态的召回比翻旧账窄', () => {
    const now = planMemoryRecall('你在干嘛')
    const old = planMemoryRecall('你还记得以前那次吗')
    expect(now.memoryCount).toBeLessThan(old.memoryCount)
    expect(now.intent).toBe('current_state')
    expect(old.intent).toBe('long_term')
  })

  it('纠错给更多断言，少下结论', () => {
    const plan = planMemoryRecall('你记错了')
    expect(plan.intent).toBe('correction')
    expect(plan.factCount).toBeGreaterThanOrEqual(10)
    expect(plan.note).toContain('证据')
  })

  it('返回值结构固定', () => {
    const plan = planMemoryRecall('随便说点什么')
    expect(MEMORY_INTENTS).toContain(plan.intent)
    expect(typeof plan.memoryCount).toBe('number')
    expect(typeof plan.factCount).toBe('number')
    expect(typeof plan.preferRecent).toBe('boolean')
    expect(typeof plan.reason).toBe('string')
  })
})

describe('memoryRecallPlan', () => {
  it('未知意图退回默认', () => {
    const plan = memoryRecallPlan('不存在')
    expect(plan.intent).toBe('recent_topic')
    expect(plan.memoryCount).toBe(24)
  })
})

describe('describeRecallPlan', () => {
  it('给日志一句话', () => {
    expect(describeRecallPlan(planMemoryRecall('你在干嘛'))).toContain('current_state')
    expect(describeRecallPlan(null)).toBe('')
  })
})
