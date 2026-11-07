import { describe, expect, it, vi } from 'vitest'

import {
  auditPlan,
  createDailyPlanService,
  extractPlanJson,
  normalizeRawSegments,
  toMinute
} from '../daily-plan.mjs'

const ENABLED = { companion: { companionLayer: { enabled: true }, chat: { provider: 'deepseek' } } }
const DISABLED = { companion: { companionLayer: { enabled: false } } }

const TODAY = new Date(2026, 10, 5, 9, 0, 0, 0).getTime()

const GOOD_REPLY = JSON.stringify({
  segments: [
    { id: 'sleep', start: '00:00', end: '07:00', title: '睡觉', kind: 'sleep' },
    { id: 'morning', start: '07:00', end: '08:00', title: '起床', kind: 'rest' },
    { id: 'work', start: '08:00', end: '12:00', title: '写东西', kind: 'work' },
    { id: 'lunch', start: '12:00', end: '13:00', title: '午饭', kind: 'meal' },
    { id: 'afternoon', start: '13:00', end: '18:00', title: '下午的事', kind: 'chore' },
    { id: 'evening', start: '18:00', end: '22:00', title: '闲下来', kind: 'leisure' },
    { id: 'night', start: '22:00', end: '24:00', title: '准备睡', kind: 'rest' }
  ]
})

function makeCompanion(overrides = {}) {
  return {
    currentAgenda: vi.fn(async () => null),
    setAgenda: vi.fn(async () => true),
    ...overrides
  }
}

function makeFetch(content = GOOD_REPLY, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] })
  }))
}

function makeService(overrides = {}) {
  return createDailyPlanService({
    getSettings: () => ENABLED,
    getApiKey: async () => 'sk-test',
    companion: makeCompanion(),
    now: () => TODAY,
    fetchImpl: makeFetch(),
    log: vi.fn(),
    ...overrides
  })
}

describe('节目单解析', () => {
  it('HH:MM 与分钟数都能转', () => {
    expect(toMinute('00:00')).toBe(0)
    expect(toMinute('09:30')).toBe(570)
    expect(toMinute('24:00')).toBe(1440)
    expect(toMinute(600)).toBe(600)
  })

  it('非法时间返回 null', () => {
    expect(toMinute('25:00')).toBeNull()
    expect(toMinute('9:5')).toBeNull()
    expect(toMinute('')).toBeNull()
    expect(toMinute(null)).toBeNull()
    expect(toMinute(-1)).toBeNull()
  })

  it('能从代码块和前后废话里取出 JSON', () => {
    expect(extractPlanJson(GOOD_REPLY)?.segments).toHaveLength(7)
    expect(extractPlanJson(`好的，这是安排：\n\`\`\`json\n${GOOD_REPLY}\n\`\`\``)?.segments).toHaveLength(7)
    expect(extractPlanJson('前面的话 ' + GOOD_REPLY + ' 后面的话')?.segments).toHaveLength(7)
  })

  it('坏 JSON 返回 null，不抛错', () => {
    expect(extractPlanJson('{"segments":[')).toBeNull()
    expect(extractPlanJson('没有 json')).toBeNull()
    expect(extractPlanJson(null)).toBeNull()
  })

  it('坏段会被丢掉，合法段留下', () => {
    const segments = normalizeRawSegments([
      { start: '07:00', end: '08:00', title: '起床', kind: 'rest' },
      { start: '25:00', end: '26:00', title: '不存在', kind: 'other' },
      { start: '09:00', end: '10:00', title: '上班', kind: 'work' },
      'not-an-object'
    ])
    expect(segments.map((segment) => segment.title)).toEqual(['起床', '上班'])
  })
})

describe('每日节目单服务', () => {
  it('生成成功后交给陪伴层，第二次不再请求', async () => {
    const companion = makeCompanion()
    const fetchImpl = makeFetch()
    const service = makeService({ companion, fetchImpl })

    const first = await service.ensure()
    expect(first.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(companion.setAgenda).toHaveBeenCalledTimes(1)

    const plan = companion.setAgenda.mock.calls[0][0]
    expect(plan.segments.length).toBeGreaterThan(0)
    expect(plan.segments[0].startMinute).toBe(0)
    expect(plan.source).toBe('model')

    const second = await service.ensure()
    expect(second.skipped).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('今天已经有生成好的单时直接复用', async () => {
    const existing = { date: '2026-11-05', generatedAt: TODAY, source: 'model', segments: [] }
    const companion = makeCompanion({ currentAgenda: vi.fn(async () => existing) })
    const fetchImpl = makeFetch()
    const service = makeService({ companion, fetchImpl })

    const result = await service.ensure()
    expect(result.skipped).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(companion.setAgenda).not.toHaveBeenCalled()
  })

  it('没有钥匙时不请求，也不写节目单', async () => {
    const companion = makeCompanion()
    const fetchImpl = makeFetch()
    const service = makeService({ companion, fetchImpl, getApiKey: async () => null })

    const result = await service.ensure()
    expect(result.reason).toBe('no-key')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(companion.setAgenda).not.toHaveBeenCalled()
  })

  it('模型回了坏 JSON 时保留原有安排', async () => {
    const companion = makeCompanion()
    const service = makeService({ companion, fetchImpl: makeFetch('我安排好了') })

    const result = await service.ensure()
    expect(result.reason).toBe('bad-json')
    expect(companion.setAgenda).not.toHaveBeenCalled()
  })

  it('失败后同一天不再重试', async () => {
    const fetchImpl = makeFetch('', 500)
    const service = makeService({ fetchImpl })

    const first = await service.ensure()
    expect(first.ok).toBe(false)
    const second = await service.ensure()
    expect(second.skipped).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('总开关关掉时什么都不做', async () => {
    const fetchImpl = makeFetch()
    const service = makeService({ getSettings: () => DISABLED, fetchImpl })

    const result = await service.ensure()
    expect(result.reason).toBe('disabled')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('并发调用共用同一次请求', async () => {
    const fetchImpl = makeFetch()
    const service = makeService({ fetchImpl })

    await Promise.all([service.ensure(), service.ensure(), service.ensure()])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('reset 后可以重新生成', async () => {
    const fetchImpl = makeFetch()
    const service = makeService({ fetchImpl })

    await service.ensure()
    service.reset()
    await service.ensure()
    // 第二次会因为 currentAgenda 仍返回 null 而真的重新生成。
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('force 会跳过「今天已有」直接重新生成', async () => {
    const existing = { date: '2026-11-05', generatedAt: TODAY, source: 'model', segments: [] }
    const companion = makeCompanion({ currentAgenda: vi.fn(async () => existing) })
    const fetchImpl = makeFetch()
    const service = makeService({ companion, fetchImpl })

    const result = await service.ensure(true)
    expect(result.ok).toBe(true)
    expect(result.skipped).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('auditPlan', () => {
  function seg(startMinute, endMinute, title, kind) {
    return { id: `${startMinute}-${endMinute}`, startMinute, endMinute, title, kind }
  }

  /** 结构合法、内容也像样的一天。 */
  const GOOD = [
    seg(0, 420, '夜里睡觉', 'sleep'),
    seg(420, 480, '起床洗漱', 'rest'),
    seg(480, 540, '吃早饭', 'meal'),
    seg(540, 720, '写代码', 'work'),
    seg(720, 780, '吃午饭', 'meal'),
    seg(780, 1020, '继续写代码', 'work'),
    seg(1020, 1080, '出门散步', 'leisure'),
    seg(1080, 1200, '做晚饭', 'chore'),
    seg(1200, 1320, '看会儿书', 'study'),
    seg(1320, 1440, '关灯躺下', 'sleep')
  ]

  it('像样的一天直接通过', () => {
    const result = auditPlan({ segments: GOOD })
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('没有睡觉的一天不收', () => {
    const segments = GOOD.map((item) =>
      item.kind === 'sleep' ? { ...item, kind: 'work' } : item
    )
    expect(auditPlan({ segments }).issues).toContain('no-sleep')
  })

  it('段数太少不收', () => {
    const segments = [
      seg(0, 480, '夜里睡觉', 'sleep'),
      seg(480, 720, '工作', 'work'),
      seg(720, 1080, '工作二', 'work'),
      seg(1080, 1440, '休息', 'rest')
    ]
    expect(auditPlan({ segments }).issues).toContain('too-few-segments')
  })

  it('标题重复不收', () => {
    const segments = GOOD.map((item) => ({ ...item, title: '干活' }))
    expect(auditPlan({ segments }).issues).toContain('duplicate-title')
  })

  it('一段超过八小时不收', () => {
    const segments = [
      seg(0, 540, '夜里睡觉', 'sleep'),
      seg(540, 900, '一口气干活', 'work'),
      seg(900, 960, '吃饭', 'meal'),
      seg(960, 1020, '散步', 'leisure'),
      seg(1020, 1080, '洗澡', 'chore'),
      seg(1080, 1140, '看书', 'study'),
      seg(1140, 1200, '发呆', 'rest'),
      seg(1200, 1260, '收拾', 'chore'),
      seg(1260, 1320, '听歌', 'leisure'),
      seg(1320, 1440, '关灯躺下', 'sleep')
    ]
    expect(auditPlan({ segments }).issues).toContain('segment-too-long')
  })

  it('没有铺满二十四小时不收', () => {
    expect(auditPlan({ segments: GOOD.slice(0, -1) }).issues).toContain('not-full-day')
  })

  it('种类太单一不收', () => {
    const segments = GOOD.map((item) => ({
      ...item,
      kind: item.kind === 'sleep' ? 'sleep' : 'work'
    }))
    expect(auditPlan({ segments }).issues).toContain('monotonous')
  })

  it('空输入和非对象不抛错', () => {
    expect(auditPlan(null).ok).toBe(false)
    expect(auditPlan({}).issues).toContain('too-few-segments')
    expect(auditPlan({ segments: [] }).ok).toBe(false)
  })
})
