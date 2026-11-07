import { describe, expect, it } from 'vitest'
import {
  MAX_LINE_CHARS,
  buildBubblePrompt,
  cleanBubbleLine,
  createPresenceService,
  describeMotions,
  fallbackLine,
  fetchWeather,
  moodSnapshot,
  parseMotionTag,
  timeContext,
  weatherCodeToText
} from '../presence.mjs'

/** 固定本地时间，避免测试跟机器时区跑。 */
function at(hour, minute = 0) {
  return new Date(2026, 10, 1, hour, minute, 0, 0)
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

describe('timeContext', () => {
  it('把深夜和上午分开', () => {
    expect(timeContext(at(3)).period).toBe('深夜')
    expect(timeContext(at(10)).period).toBe('上午')
    expect(timeContext(at(20)).period).toBe('晚上')
  })

  it('给出可读的日期与时钟', () => {
    const ctx = timeContext(at(9, 5))
    expect(ctx.dateLabel).toBe('11月1日')
    expect(ctx.clock).toBe('09:05')
    expect(ctx.weekday).toBe('周日')
  })
})

describe('weatherCodeToText', () => {
  it('认识的代码翻成中文', () => {
    expect(weatherCodeToText(0)).toBe('晴')
    expect(weatherCodeToText(61)).toBe('小雨')
  })

  it('不认识就说天气不明，不猜', () => {
    expect(weatherCodeToText(1234)).toBe('天气不明')
  })
})

describe('moodSnapshot', () => {
  it('深夜会担心对方没睡', () => {
    const mood = moodSnapshot({ now: at(2) })
    expect(mood.level).toBe('sleepy')
    expect(mood.reasons).toContain('现在是深夜')
  })

  it('十分钟内被点过是开心状态', () => {
    const now = at(20)
    const mood = moodSnapshot({ now, lastContactAt: new Date(now.getTime() - 60_000) })
    expect(mood.level).toBe('bright')
  })

  it('陪了三小时以上会黏人', () => {
    const now = at(20)
    const mood = moodSnapshot({ now, sessionStartedAt: new Date(now.getTime() - 4 * 3600_000) })
    expect(mood.level).toBe('clingy')
  })
})

describe('cleanBubbleLine', () => {
  it('去掉整段引号和说话人前缀', () => {
    expect(cleanBubbleLine('「晚上好呀，今天辛苦了。」')).toBe('晚上好呀，今天辛苦了。')
    expect(cleanBubbleLine('昔涟：该歇一会儿了。')).toBe('该歇一会儿了。')
  })

  it('只取第一句，不把解释带进气泡', () => {
    expect(cleanBubbleLine('先喝口水吧。\n我是根据时间提醒的。')).toBe('先喝口水吧。')
  })

  it('超长会截断到上限', () => {
    const line = cleanBubbleLine('啊'.repeat(MAX_LINE_CHARS + 20))
    expect([...line].length).toBe(MAX_LINE_CHARS)
  })

  it('空内容和非字符串返回 null', () => {
    expect(cleanBubbleLine('   ')).toBeNull()
    expect(cleanBubbleLine(null)).toBeNull()
  })
})

describe('buildBubblePrompt', () => {
  it('把时间、天气、心情、记忆都交给模型', () => {
    const prompt = buildBubblePrompt({
      nickname: '旅人',
      personaText: '你是昔涟。',
      timeCtx: timeContext(at(20, 16)),
      weather: { ok: true, city: '重庆', text: '小雨', temperature: 18 },
      mood: { label: '刚被注意到', level: 'bright', reasons: [] },
      memoryDigest: '对方今天在改设置页'
    })
    expect(prompt.user).toContain('旅人')
    expect(prompt.user).toContain('重庆小雨')
    expect(prompt.user).toContain('18℃')
    expect(prompt.user).toContain('刚被注意到')
    expect(prompt.user).toContain('改设置页')
    expect(prompt.system).toContain(`${MAX_LINE_CHARS} 个字`)
  })

  it('天气拿不到时只是少一句，不写「天气不明」', () => {
    const prompt = buildBubblePrompt({
      timeCtx: timeContext(at(10)),
      weather: { ok: false, reason: 'network' }
    })
    expect(prompt.user).not.toContain('天气')
  })

  it('昵称为空时用中性称呼', () => {
    const prompt = buildBubblePrompt({ timeCtx: timeContext(at(10)), nickname: '' })
    expect(prompt.user).toContain('对方')
  })

  it('有话头到点时，只把这一件事递到眼前', () => {
    const prompt = buildBubblePrompt({
      timeCtx: timeContext(at(11)),
      focusText: '明天要去面试'
    })

    expect(prompt.user).toContain('明天要去面试')
    expect(prompt.user).toContain('还没说完')
  })

  it('没有话头时不写这一段，避免凭空捏造一件没发生的事', () => {
    const prompt = buildBubblePrompt({ timeCtx: timeContext(at(11)) })
    expect(prompt.user).not.toContain('还没说完')
  })
})

describe('fetchWeather', () => {
  it('成功时返回温度和天气文本', async () => {
    const result = await fetchWeather({
      city: '重庆',
      fetchImpl: async () =>
        jsonResponse({ current: { temperature_2m: 18.4, weather_code: 61 } })
    })
    expect(result).toMatchObject({ ok: true, city: '重庆', temperature: 18, text: '小雨' })
  })

  it('HTTP 失败如实返回原因', async () => {
    const result = await fetchWeather({
      fetchImpl: async () => jsonResponse({}, false, 503)
    })
    expect(result).toEqual({ ok: false, reason: 'http-503' })
  })

  it('网络异常不抛出', async () => {
    const result = await fetchWeather({
      fetchImpl: async () => {
        throw new Error('boom')
      }
    })
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('不认识的城市回落到默认城市，并标出实际用的', async () => {
    const result = await fetchWeather({
      city: '不存在的城',
      fetchImpl: async () =>
        jsonResponse({ current: { temperature_2m: 20, weather_code: 0 } })
    })
    expect(result.city).toBe('重庆')
    expect(result.requested).toBe('不存在的城')
  })
})

describe('createPresenceService', () => {
  const settings = {
    nickname: '旅人',
    presence: { city: '重庆', useWeather: true },
    companion: { chat: { model: 'deepseek-chat' } }
  }

  it('没有密钥时用本地短句，不让气泡空着', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => '',
      getMemoryDigest: () => '',
      getPersonaText: () => '你是昔涟。',
      fetchImpl: async () => jsonResponse({ current: { temperature_2m: 18, weather_code: 61 } }),
      now: () => at(20)
    })
    const result = await service.nextLine()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-key')
    expect(typeof result.line).toBe('string')
    expect(result.line.length).toBeGreaterThan(0)
  })

  it('模型成功时用模型写的句子', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => 'sk-test',
      getMemoryDigest: () => '',
      getPersonaText: () => '你是昔涟。',
      fetchImpl: async (url) => {
        if (String(url).includes('open-meteo')) {
          return jsonResponse({ current: { temperature_2m: 18, weather_code: 61 } })
        }
        return jsonResponse({ choices: [{ message: { content: '「下雨了，记得带伞呀。」' } }] })
      },
      now: () => at(20)
    })
    const result = await service.nextLine()
    expect(result.ok).toBe(true)
    expect(result.line).toBe('下雨了，记得带伞呀。')
    expect(result.source).toBe('model')
  })

  it('模型失败时回落到本地短句', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => 'sk-test',
      getMemoryDigest: () => '',
      fetchImpl: async (url) => {
        if (String(url).includes('open-meteo')) {
          return jsonResponse({ current: { temperature_2m: 18, weather_code: 0 } })
        }
        return jsonResponse({}, false, 500)
      },
      now: () => at(20)
    })
    const result = await service.nextLine()
    expect(result.ok).toBe(false)
    expect(result.source).toBe('fallback')
    expect(result.line.length).toBeGreaterThan(0)
  })

  it('天气在缓存期内只请求一次', async () => {
    let weatherCalls = 0
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => '',
      fetchImpl: async (url) => {
        if (String(url).includes('open-meteo')) {
          weatherCalls += 1
          return jsonResponse({ current: { temperature_2m: 18, weather_code: 0 } })
        }
        return jsonResponse({ choices: [{ message: { content: '好呀。' } }] })
      },
      now: () => at(20)
    })
    await service.nextLine()
    await service.nextLine()
    expect(weatherCalls).toBe(1)
  })

  it('关掉天气后不再请求外部接口', async () => {
    let called = 0
    const service = createPresenceService({
      getSettings: () => ({ ...settings, presence: { city: '重庆', useWeather: false } }),
      getApiKey: async () => 'sk-test',
      fetchImpl: async () => {
        called += 1
        return jsonResponse({ choices: [{ message: { content: '好呀。' } }] })
      },
      now: () => at(20)
    })
    await service.nextLine()
    expect(called).toBe(1)
  })

  it('会话上下文里不含密钥', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => 'sk-secret',
      getMemoryDigest: () => '',
      fetchImpl: async () =>
        jsonResponse({ current: { temperature_2m: 18, weather_code: 0 } }),
      now: () => at(20)
    })
    const context = await service.peekContext()
    expect(JSON.stringify(context)).not.toContain('sk-secret')
  })
})

describe('fallbackLine', () => {
  it('深夜不说早安', () => {
    const line = fallbackLine(timeContext(at(3)), null)
    expect(line).not.toContain('早上好')
    expect(line).not.toContain('上午好')
  })
})

describe('parseMotionTag', () => {
  it('认得方括号、中文括号和全角冒号三种写法', () => {
    expect(parseMotionTag('早点休息。[动作:sleepyNod]')).toEqual({
      text: '早点休息。',
      motion: 'sleepyNod'
    })
    expect(parseMotionTag('来跳舞呀【动作：bounce】')).toEqual({ text: '来跳舞呀', motion: 'bounce' })
    expect(parseMotionTag('（动作: nod）好呀')).toEqual({ text: '好呀', motion: 'nod' })
  })

  it('没有标记时原样返回，motion 为 null', () => {
    expect(parseMotionTag('今天也辛苦啦。')).toEqual({ text: '今天也辛苦啦。', motion: null })
    expect(parseMotionTag('')).toEqual({ text: '', motion: null })
    expect(parseMotionTag(null)).toEqual({ text: '', motion: null })
  })

  it('只取第一个标记，多写的不会串进气泡', () => {
    const parsed = parseMotionTag('嗨。[动作:nod][动作:shake]')
    expect(parsed.motion).toBe('nod')
    expect(parsed.text).not.toContain('动作:nod')
  })

  it('先摘标记或交给清洗兜底，两条路径都不会漏出标记残骸', () => {
    const raw = '早点休息。[动作:sleepyNod]'
    expect(cleanBubbleLine(parseMotionTag(raw).text)).toBe('早点休息。')
    // 清洗里也剥标记：就算调用顺序被改坏，气泡里也不会出现 sleepyNod]。
    expect(cleanBubbleLine(raw)).toBe('早点休息。')
    expect(cleanBubbleLine('【动作：bounce】来跳舞呀')).toBe('来跳舞呀')
  })

  it('整段只有标记时清洗返回 null，让调用方走回落', () => {
    expect(cleanBubbleLine('[动作:nod]')).toBeNull()
    expect(cleanBubbleLine('（动作: nod）')).toBeNull()
  })
})

describe('describeMotions', () => {
  it('把探测到的能力写成带中文标签的清单', () => {
    const text = describeMotions({ actions: ['nod', 'bounce'], labels: { nod: '点头', bounce: '弹一下' } })
    expect(text).toBe('点头(nod)、弹一下(bounce)')
  })

  it('没有可用动作时返回空串，提示词里就不会出现「你能做的动作」', () => {
    expect(describeMotions(null)).toBe('')
    expect(describeMotions({ actions: [] })).toBe('')
    expect(describeMotions({})).toBe('')
  })

  it('缺标签时退回 key，不写 undefined', () => {
    expect(describeMotions({ actions: ['tilt'] })).toBe('tilt')
  })
})

describe('buildBubblePrompt 的动作部分', () => {
  it('有能力时才告诉模型怎么点动作', () => {
    const prompt = buildBubblePrompt({
      timeCtx: timeContext(at(20)),
      motions: { actions: ['nod'], labels: { nod: '点头' } }
    })
    expect(prompt.user).toContain('你此刻能做的动作：点头(nod)')
    expect(prompt.system).toContain('[动作:名称]')
  })

  it('探测不到能力就完全不提动作，不给模型编造的机会', () => {
    const prompt = buildBubblePrompt({ timeCtx: timeContext(at(20)), motions: null })
    expect(prompt.user).not.toContain('能做的动作')
    expect(prompt.system).not.toContain('[动作:')
  })
})

describe('生活细节：节日与穿搭', () => {
  it('体感温度优先于实际温度', async () => {
    const result = await fetchWeather({
      fetchImpl: async () =>
        jsonResponse({
          current: { temperature_2m: 18.4, apparent_temperature: 14.6, weather_code: 61 }
        })
    })
    expect(result).toMatchObject({ ok: true, temperature: 18, feelsLike: 15 })
  })

  it('体感温度缺失时退回实际温度', async () => {
    const result = await fetchWeather({
      fetchImpl: async () =>
        jsonResponse({ current: { temperature_2m: 18.4, weather_code: 61 } })
    })
    expect(result.feelsLike).toBe(18)
  })

  it('提示词里同时有节日和穿搭', () => {
    const prompt = buildBubblePrompt({
      timeCtx: timeContext(at(20)),
      lifestyleNote: '今天是国庆节；外面微凉，薄外套配长袖，早晚会差一点'
    })
    expect(prompt.user).toContain('今天是国庆节')
    expect(prompt.user).toContain('薄外套')
  })

  it('天气失败时保留节日，只省略穿搭', async () => {
    const service = createPresenceService({
      getSettings: () => ({
        nickname: '旅人',
        presence: { city: '重庆', useWeather: true },
        companion: { chat: { model: 'deepseek-chat' } }
      }),
      getApiKey: async () => '',
      fetchImpl: async () => jsonResponse({}, false, 503),
      now: () => new Date(2026, 9, 1, 20)
    })

    const note = await service.currentLifestyleNote()
    expect(note).toContain('国庆节')
    expect(note).not.toContain('外面')
  })

  it('没有节日也没有温度时整段为空', async () => {
    const service = createPresenceService({
      getSettings: () => ({
        nickname: '旅人',
        presence: { city: '重庆', useWeather: false },
        companion: { chat: { model: 'deepseek-chat' } }
      }),
      getApiKey: async () => '',
      now: () => at(20)
    })

    expect(await service.currentLifestyleNote()).toBe('')
  })

  it('nextLine 把节日和穿搭交给模型', async () => {
    const requests = []
    const service = createPresenceService({
      getSettings: () => ({
        nickname: '旅人',
        presence: { city: '重庆', useWeather: true },
        companion: { chat: { model: 'deepseek-chat' } }
      }),
      getApiKey: async () => 'sk-test',
      fetchImpl: async (url, init) => {
        if (String(url).includes('open-meteo')) {
          return jsonResponse({
            current: { temperature_2m: 18.4, apparent_temperature: 14.6, weather_code: 0 }
          })
        }
        requests.push(JSON.parse(init.body).messages)
        return jsonResponse({ choices: [{ message: { content: '国庆快乐呀。' } }] })
      },
      now: () => new Date(2026, 9, 1, 20)
    })

    await service.nextLine()
    const sent = requests[0].map((message) => message.content).join('\n')
    expect(sent).toContain('国庆节')
    expect(sent).toContain('薄外套')
  })
})

describe('nextLine 透出动作', () => {
  const settings = {
    nickname: '旅人',
    // 这组测试看的是动作标记解析，固定凌晨时间，所以把安静时段关掉。
    presence: { city: '重庆', useWeather: false, quiet: { enabled: false } },
    companion: { chat: { model: 'deepseek-chat' } }
  }

  it('模型给了动作标记就一起返回，标记不进台词', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => 'sk-test',
      getMemoryDigest: () => '',
      getMotionCatalog: () => ({ actions: ['sleepyNod'], labels: { sleepyNod: '打瞌睡' } }),
      fetchImpl: async () =>
        jsonResponse({ choices: [{ message: { content: '「该睡了呀。[动作:sleepyNod]」' } }] }),
      now: () => at(1)
    })
    const result = await service.nextLine()
    expect(result.ok).toBe(true)
    expect(result.line).toBe('该睡了呀。')
    expect(result.motion).toBe('sleepyNod')
  })

  it('模型没给标记时 motion 是 null，不硬塞一个', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => 'sk-test',
      fetchImpl: async () => jsonResponse({ choices: [{ message: { content: '喝口水吧。' } }] }),
      now: () => at(20)
    })
    const result = await service.nextLine()
    expect(result.line).toBe('喝口水吧。')
    expect(result.motion).toBeNull()
  })

  it('回落短句不带动作', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => '',
      fetchImpl: async () => jsonResponse({}),
      now: () => at(20)
    })
    const result = await service.nextLine()
    expect(result.source).toBe('fallback')
    expect(result.motion).toBeUndefined()
  })
})

describe('开口的账跨重启', () => {
  const settings = {
    presence: { city: '重庆', useWeather: false, quiet: { enabled: false }, dailyCap: 2 }
  }

  it('说过一句就把时间和次数写出去', async () => {
    const saved = []
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => '',
      fetchImpl: async () => jsonResponse({}),
      now: () => at(20),
      saveState: (value) => saved.push(value)
    })

    service.noteContact(at(20))
    await service.nextLine('auto')

    const last = saved.at(-1)
    expect(last.lastContactAt).toBe(at(20).toISOString())
    expect(last.gate.spokenToday).toBe(1)
  })

  it('重启后接着落盘的账算，不会重新给满额', async () => {
    const service = createPresenceService({
      getSettings: () => settings,
      getApiKey: async () => '',
      fetchImpl: async () => jsonResponse({}),
      now: () => at(21),
      loadState: () => ({
        lastContactAt: at(21).toISOString(),
        gate: { day: '2026-11-01', spokenToday: 2 }
      })
    })

    const result = await service.nextLine('auto')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('daily-cap')
  })
})
