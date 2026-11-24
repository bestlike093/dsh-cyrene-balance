/**
 * 脉络：把零散记忆、事实和当下心情串成一条「她正在意什么」的线。
 *
 * 分工是刻意写死的：
 * - 大事（major）与极小的事（micro）由人格直接裁决；
 * - 小事（minor）由人格给出边界，情绪、习惯、关系这些子系统在边界里决定具体反应。
 *
 * 这个模块只负责「哪条事算哪一层、先看哪条」，
 * 不负责生成台词，也不改关系分。它输出的是给提示词用的一小段脉络。
 */
import { THREAD } from './standard.mjs'

/* 大事词：出现这些词，说明这句话在改「以后怎么过」，人格必须亲自接。 */
const MAJOR_WORDS = [
  '永远', '再也不', '分手', '离开', '答应', '约好', '约定', '承诺',
  '生日', '去世', '生病', '手术', '搬家', '结婚', '离婚', '考试',
  '工作', '未来', '秘密', '梦想', '害怕失去', '最后一次',
]

/* 极小事词：日常偏好、语气、口味这类，交给情绪和习惯去接就够了。 */
const MICRO_WORDS = [
  '喜欢', '讨厌', '好吃', '好看', '可爱', '困', '饿', '累',
  '天气', '颜色', '猫', '狗', '歌', '游戏', '咖啡', '奶茶',
]

/* 分量算法的底分与加减幅度由统一标准给；关键词表属于本模块的语义，留在这里。 */
const SLOT_BASE = THREAD.slotBase

/*
 * 心情对「微小的事」的可见度只做确定性投影，不改大事的层级。
 * 高兴时愿意多接一句日常，低落或烦躁时把日常收起来，把注意力留给真正重的事。
 * 键同时接受快照的 mood.key 与中文 label，避免上游只给一种时静默失效。
 * 具体幅度来自标准表，这里只保留中文标签到键的别名。
 */
const MOOD_MICRO_BIAS = THREAD.moodMicroBias

const MOOD_KEY_ALIASES = Object.freeze({
  轻快: 'bright',
  雀跃: 'excited',
  平静: 'calm',
  低落: 'low',
  不安: 'restless',
})

function moodKeyOf(mood, moodKey = '') {
  const key = String(moodKey ?? '').trim()
  if (key !== '') return key
  const label = String(mood ?? '').trim()
  return MOOD_KEY_ALIASES[label] ?? label
}

/** 亲近只加成「关系 / 身份」类节点，避免一句天气也因关系好而升格。 */
function closenessBonus(item, closeness) {
  if (item.slot !== 'relationship' && item.slot !== 'identity') return 0
  return closeness * THREAD.closenessBonus
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0))
}

function hits(text, words) {
  const source = String(text ?? '')
  return words.reduce((count, word) => (source.includes(word) ? count + 1 : count), 0)
}

/**
 * 给一件事定分量。
 * 基础分看槽位，关键词、固定、置信度、亲近度与心情只做确定性的加减，不引入随机。
 * 大事一旦成立就不再被心情改动；心情与关系只影响小事和极小事的分量。
 */
export function weighEvent(item = {}, { closeness = 0, moodKey = '' } = {}) {
  const text = String(item.text ?? '').replace(/\s+/g, ' ').trim()
  if (text === '') return { weight: 0, tier: 'micro', driver: 'persona', reason: 'empty' }

  const base = SLOT_BASE[item.slot] ?? THREAD.defaultSlotBase
  const majorHits = hits(text, MAJOR_WORDS)
  const microHits = hits(text, MICRO_WORDS)
  const moodBias = MOOD_MICRO_BIAS[moodKeyOf('', moodKey)] ?? 0
  const confidence = Number.isFinite(item.confidence)
    ? clamp01(item.confidence)
    : THREAD.confidenceBaseline

  let weight = base
  weight += Math.min(THREAD.majorWordCap, majorHits * THREAD.majorWordStep)
  weight -= Math.min(THREAD.microWordCap, microHits * THREAD.microWordPenalty)
  weight += (confidence - THREAD.confidenceBaseline) * THREAD.confidenceWeight
  if (item.pinned === true) weight += THREAD.pinnedBonus
  if (item.personaLed === true) weight += THREAD.personaBonus
  weight += closenessBonus(item, clamp01(closeness))

  let tier = 'minor'
  if (weight >= THREAD.majorWeight) tier = 'major'
  else if (weight < THREAD.minorWeight) tier = 'micro'

  /* 大事已经由人格接住，心情不再改它的分量；小事与极小事只改排序，不改层级。 */
  if (tier !== 'major') {
    weight += moodBias
    weight = clamp01(Number(weight.toFixed(4)))
  }

  return {
    weight,
    tier,
    /* 大事与极小事由人格直接接住；小事由人格给边界，子系统在边界里挑具体反应。 */
    driver: tier === 'minor' ? 'subsystems' : 'persona',
    reason:
      majorHits > 0
        ? 'major-word'
        : microHits > 0
          ? 'micro-word'
          : 'base',
  }
}

/**
 * 同一条展示文本出现多次时，谁更该留下。
 * 先比分量，再比置信度，最后比新近；全一样就保留先到的那条。
 */
function nodeIsBetter(next, previous) {
  if (next.weight !== previous.weight) return next.weight > previous.weight
  if (next.confidence !== previous.confidence) return next.confidence > previous.confidence
  return next.lastAt > previous.lastAt
}

/**
 * 把记忆与事实整理成脉络节点。
 * 同一段文字只留分量最高的一条；同分时再比置信度与新近。
 * 去重键用「实际会显示出来的截断文本」，避免两条长文前半段相同、各自占一个节点。
 */
export function buildThreads({
  memories = [],
  facts = [],
  mood = '',
  moodKey = '',
  relationScore = 0,
  now = Date.now(),
} = {}) {
  const nodes = new Map()
  const closeness = clamp01((Number(relationScore) || 0) / 100)
  const activeMood = moodKeyOf(mood, moodKey)
  /* 关系越近，越允许把「以后」的事放进脉络；这里只做可见范围，不改分量。 */
  const cap = Math.max(
    THREAD.minNodeCap,
    Math.round(THREAD.maxNodes * (THREAD.closenessBase + closeness * THREAD.closenessSpan)),
  )

  const push = (item, kind) => {
    const text = String(item?.text ?? item ?? '').replace(/\s+/g, ' ').trim()
    if (text === '') return
    const displayText = text.slice(0, THREAD.nodeTextLimit)
    const verdict = weighEvent({ ...item, text }, { closeness, moodKey: activeMood })
    /* 「问起再说」跟着节点一起走：同一句话被记忆和事实同时提到时，不能让较松的那条把限制洗掉。 */
    const mentionPolicy = item?.mentionPolicy === 'on_request' ? 'on_request' : ''
    const node = {
      text: displayText,
      kind,
      slot: item?.slot ?? '',
      tier: verdict.tier,
      driver: verdict.driver,
      weight: verdict.weight,
      confidence: Number.isFinite(item?.confidence) ? item.confidence : THREAD.confidenceBaseline,
      lastAt: Number(item?.lastAt ?? item?.at ?? 0) || 0,
      mentionPolicy,
    }
    const previous = nodes.get(displayText)
    if (previous === undefined) {
      nodes.set(displayText, node)
    } else {
      if (mentionPolicy === 'on_request') previous.mentionPolicy = 'on_request'
      if (nodeIsBetter(node, previous)) {
        node.mentionPolicy = previous.mentionPolicy
        nodes.set(displayText, node)
      }
    }
  }

  for (const item of Array.isArray(memories) ? memories : []) push(item, 'memory')
  for (const item of Array.isArray(facts) ? facts : []) push(item, 'fact')

  const selected = [...nodes.values()]
    .sort((a, b) =>
      b.weight - a.weight ||
      b.confidence - a.confidence ||
      b.lastAt - a.lastAt ||
      a.text.localeCompare(b.text, 'zh-CN'),
    )
    .slice(0, cap)

  return {
    nodes: selected,
    mood: String(mood ?? '').trim(),
    moodKey: activeMood,
    closeness,
    major: selected.filter((node) => node.tier === 'major').length,
    minor: selected.filter((node) => node.tier === 'minor').length,
    micro: selected.filter((node) => node.tier === 'micro').length,
    cap,
    now,
  }
}

const TIER_LABEL_ZH = Object.freeze({
  major: '大事，由人格亲自裁决',
  minor: '小事，人格给边界，子系统挑具体反应',
  micro: '极小的事，也由人格决定要不要理',
})

const TIER_LABEL_EN = Object.freeze({
  major: 'major, decided by the persona herself',
  minor: 'minor, persona sets the boundary and subsystems choose the reaction',
  micro: 'tiny, the persona still decides whether it is worth noticing',
})

/** 渲染成提示词里的一小段；没有节点时返回空串，不占位置。 */
export function renderThreadPrompt(threads, locale = 'zh-CN') {
  const nodes = Array.isArray(threads?.nodes) ? threads.nodes : []
  if (nodes.length === 0) return ''
  const zh = locale !== 'en-US'
  const label = zh ? TIER_LABEL_ZH : TIER_LABEL_EN
  const head = zh ? '【此刻的脉络】' : '[Threads right now]'
  const tail = zh
    ? '这些事按分量排好了：大事和极小的事都由你自己拿主意；小事你只给边界，情绪、习惯、身体在这个边界里挑具体说法。'
    : 'These are ordered by weight: you decide both major and tiny things yourself; for minor things you set the boundary, and mood, habit, and body choose the exact reaction inside it.'
  const lines = nodes.map((node) => {
    const suffix = node.mentionPolicy === 'on_request'
      ? (zh ? '（只在对方问起时接，别主动提）' : ' (only answer if asked, do not bring it up)')
      : ''
    return `- [${label[node.tier] ?? label.minor}]${suffix} ${node.text}`
  })
  /* 心情只留在「此刻的状态」里，脉络只管事，免得同一句心情出现两次。 */
  return [head, ...lines, tail].filter((line) => line !== '').join('\n')
}
