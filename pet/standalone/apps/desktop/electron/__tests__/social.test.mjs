import { describe, expect, it } from 'vitest'
import {
  analyzeStyle,
  buildSocialNote,
  classifyMemory,
  describeFormatAdvice,
  describeStyle,
  detectCorrection,
  detectLanguagePlay,
  extractMemeCandidates,
  matchWake,
  normalizeText
} from '../social.mjs'

describe('matchWake', () => {
  it('把开头的唤醒词剥掉，只留正文', () => {
    const result = matchWake('昔涟，在吗')
    expect(result.woken).toBe(true)
    expect(result.word).toBe('昔涟')
    expect(result.text).toBe('在吗')
    expect(result.atStart).toBe(true)
  })

  it('支持 @ 写法', () => {
    const result = matchWake('@昔涟 帮我看下这个')
    expect(result.woken).toBe(true)
    expect(result.text).toBe('帮我看下这个')
  })

  it('句中出现也算命中，但不算点名开头', () => {
    const result = matchWake('刚才昔涟说的那个')
    expect(result.woken).toBe(true)
    expect(result.atStart).toBe(false)
  })

  it('没叫名字时不命中', () => {
    const result = matchWake('今天天气不错')
    expect(result.woken).toBe(false)
    expect(result.text).toBe('今天天气不错')
  })

  it('自定义唤醒词覆盖默认词', () => {
    const result = matchWake('小笨蛋，过来', { words: ['小笨蛋'] })
    expect(result.woken).toBe(true)
    expect(result.text).toBe('过来')
  })

  it('全角标点也能剥掉', () => {
    expect(normalizeText('昔涟，你好')).toBe('昔涟,你好')
  })
})

describe('analyzeStyle', () => {
  const messages = [
    { speaker: 'a', text: '在吗' },
    { speaker: 'b', text: '来了来了' },
    { speaker: 'a', text: '今天好累啊' },
    { speaker: 'b', text: '摸摸' },
    { speaker: 'a', text: '哈哈哈哈哈' },
    { speaker: 'b', text: '笑死' },
    { speaker: 'a', text: '确实' }
  ]

  it('统计短句比例和句子长度', () => {
    const stats = analyzeStyle(messages)
    expect(stats.sampleSize).toBe(7)
    expect(stats.shortRatio).toBeGreaterThan(0.8)
    expect(stats.avgLength).toBeLessThan(8)
  })

  it('样本太少时不写画像', () => {
    const stats = analyzeStyle(messages.slice(0, 2))
    expect(describeStyle(stats)).toBe('')
  })

  it('样本够时写成一句人话', () => {
    const described = describeStyle(analyzeStyle(messages))
    expect(described).toContain('这群人说话平均')
  })

  it('统计 @、表情包、连发和接话间隔', () => {
    const withFormat = [
      { speaker: 'a', text: '在吗', at: 0, mentioned: true },
      { speaker: 'a', text: '看这个', at: 10_000, imageCount: 1 },
      { speaker: 'a', text: '哈哈', at: 20_000 },
      { speaker: 'b', text: '收到', at: 25_000 },
      { speaker: 'b', text: '@a 好的', at: 30_000, mentioned: true },
      { speaker: 'c', text: '冲', at: 35_000, imageCount: 1 }
    ]
    const stats = analyzeStyle(withFormat)
    expect(stats.mentionRatio).toBeCloseTo(2 / 6)
    expect(stats.imageRatio).toBeCloseTo(2 / 6)
    expect(stats.burst.threePlus).toBeGreaterThan(0)
    expect(stats.avgGapSeconds).toBe(7)
  })

  it('格式建议会说明分几条和要不要 @', () => {
    const stats = analyzeStyle([
      { speaker: 'a', text: '一', at: 0, mentioned: true },
      { speaker: 'a', text: '二', at: 1000 },
      { speaker: 'a', text: '三', at: 2000, imageCount: 1 },
      { speaker: 'b', text: '四', at: 3000, mentioned: true },
      { speaker: 'b', text: '五', at: 4000 },
      { speaker: 'b', text: '六', at: 5000, imageCount: 1 }
    ])
    const advice = describeFormatAdvice(stats)
    expect(advice).toContain('分')
    expect(advice).toContain('@')
  })
})

describe('extractMemeCandidates', () => {
  it('跨人重复的短语才算梗', () => {
    const messages = [
      { speaker: 'a', text: '这波属实是量子纠缠了' },
      { speaker: 'b', text: '量子纠缠可还行' },
      { speaker: 'c', text: '量子纠缠一下' }
    ]
    const memes = extractMemeCandidates(messages)
    expect(memes.some((item) => item.phrase === '量子纠缠')).toBe(true)
  })

  it('一个人反复说同一句不算梗', () => {
    const messages = [
      { speaker: 'a', text: '真的假的啊' },
      { speaker: 'a', text: '真的假的啊' },
      { speaker: 'a', text: '真的假的啊' }
    ]
    const memes = extractMemeCandidates(messages)
    expect(memes.some((item) => item.phrase === '真的假的')).toBe(false)
  })

  it('常见口头禅不进入梗列表', () => {
    const messages = [
      { speaker: 'a', text: '哈哈哈哈确实' },
      { speaker: 'b', text: '哈哈哈哈确实' },
      { speaker: 'c', text: '哈哈哈哈确实' }
    ]
    const memes = extractMemeCandidates(messages)
    expect(memes.length).toBe(0)
  })
})

describe('detectLanguagePlay', () => {
  it('认出黑话和数字梗', () => {
    const result = detectLanguagePlay('这波直接破防，666')
    expect(result.slang).toContain('破防')
    expect(result.numberPlay).toContain('666')
    expect(result.likelyPlayful).toBe(true)
  })

  it('普通句子不标记', () => {
    const result = detectLanguagePlay('明天上午十点开会')
    expect(result.likelyPlayful).toBe(false)
    expect(result.slang.length).toBe(0)
  })

  it('把 OK 这类常见英文词排除在缩写之外', () => {
    const result = detectLanguagePlay('OK，就这样')
    expect(result.acronyms.length).toBe(0)
  })
})

describe('classifyMemory', () => {
  it('寒暄不记', () => {
    expect(classifyMemory('晚安').reason).toBe('greeting')
    expect(classifyMemory('好的').reason).toBe('greeting')
  })

  it('临时状态不记', () => {
    expect(classifyMemory('我今天好累，先睡了').reason).toBe('temporary')
  })

  it('玩笑不记', () => {
    expect(classifyMemory('笑死，开个玩笑啦').reason).toBe('joke')
  })

  it('凭据一律不记', () => {
    expect(classifyMemory('我的密码是 abc12345').reason).toBe('secret')
  })

  it('转述别人的话不记成用户事实', () => {
    expect(classifyMemory('我朋友说他喜欢吃辣').reason).toBe('quoted_other')
  })

  it('明确偏好要记', () => {
    const result = classifyMemory('我很喜欢喝冰美式，不加糖')
    expect(result.include).toBe(true)
    expect(result.kind).toBe('preference')
  })

  it('约定要记', () => {
    const result = classifyMemory('说好周五一起去看电影')
    expect(result.include).toBe(true)
    expect(result.kind).toBe('promise')
  })

  it('还没做的打算只算低置信度', () => {
    const result = classifyMemory('我打算下个月开始学吉他')
    expect(result.include).toBe(false)
    expect(result.reason).toBe('unfulfilled_plan')
  })

  it('普通陈述默认不记', () => {
    expect(classifyMemory('这个视频剪得挺一般的').reason).toBe('low_value')
  })

  it('明确要求忘掉会被单独识别', () => {
    expect(classifyMemory('别记这个').reason).toBe('explicit_forget')
    expect(classifyMemory('把刚才那个忘掉吧').reason).toBe('explicit_forget')
    expect(classifyMemory('删掉这条').reason).toBe('explicit_forget')
  })

  it('叙述性的「忘了」不触发删除', () => {
    expect(classifyMemory('我忘了带钥匙，现在进不去门').reason).not.toBe('explicit_forget')
  })
})

describe('buildSocialNote', () => {
  it('群聊带上说话方式，私聊不带', () => {
    const style = analyzeStyle([
      { speaker: 'a', text: '在吗' },
      { speaker: 'b', text: '来了' },
      { speaker: 'a', text: '哈哈' },
      { speaker: 'b', text: '走' },
      { speaker: 'a', text: '好' }
    ])
    const group = buildSocialNote({ scope: 'group', style })
    const priv = buildSocialNote({ scope: 'private', style })
    expect(group).toContain('群聊')
    expect(group).toContain('这群人说话平均')
    expect(priv).not.toContain('群聊')
  })

  it('有梗时提醒不要硬解释', () => {
    const note = buildSocialNote({
      scope: 'group',
      memes: [{ phrase: '量子纠缠', count: 5, speakers: ['a', 'b'], examples: [] }]
    })
    expect(note).toContain('量子纠缠')
    expect(note).toContain('不要解释')
  })

  it('没识别出语言玩法就不加那一段', () => {
    const note = buildSocialNote({ scope: 'private', play: detectLanguagePlay('明天见') })
    expect(note).not.toContain('谐音')
  })

  it('关掉格式模仿后不再写这群人的腔调', () => {
    const style = analyzeStyle([
      { speaker: 'a', text: '在吗' },
      { speaker: 'b', text: '来了' },
      { speaker: 'a', text: '哈哈' },
      { speaker: 'b', text: '走' },
      { speaker: 'a', text: '好' }
    ])
    const note = buildSocialNote({ scope: 'group', style, imitate: false })
    expect(note).toContain('群聊')
    expect(note).not.toContain('这群人说话平均')
  })
})

describe('detectCorrection', () => {
  it('把「不是 A，是 B」拆成一条可复用的纠正', () => {
    const found = detectCorrection('不对，你刚才说错了，不是周六，是周日')
    expect(found.corrected).toBe(true)
    expect(found.text).toContain('不是「周六」')
    expect(found.text).toContain('是「周日」')
  })

  it('「下次别这样」也算纠正', () => {
    const found = detectCorrection('下次别这样说话了，太生硬')
    expect(found.corrected).toBe(true)
    expect(found.text).toContain('下次别这样说话了')
  })

  it('普通自我介绍不误判成纠正', () => {
    expect(detectCorrection('我不是学生，是老师').corrected).toBe(false)
  })

  it('提问式的「是不是」不误判', () => {
    expect(detectCorrection('你是不是记错了？').corrected).toBe(false)
  })

  it('空句和过短句直接放过', () => {
    expect(detectCorrection('').corrected).toBe(false)
    expect(detectCorrection('错了').corrected).toBe(false)
  })
})
