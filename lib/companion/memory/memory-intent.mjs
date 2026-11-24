/**
 * 记忆召回分流：先判断这句话要哪一类记忆，再决定取多少。
 *
 * 为什么需要这一层：
 * 同一个召回器回答不了所有问题。「你现在在干嘛」需要的是最近几句和当下状态，
 * 翻出三个月前的高兴事只会答错题；「我以前跟你说过什么」需要更长的窗口和更多断言。
 * 只按固定条数取，两种情况里至少有一种是错的。
 *
 * 这一层只做判断，不读存储、不拼提示词、不改写原文。
 * 规则全是可解释的中文特征，不用模型：判错了顶多少给几条，不会编出新事实。
 */

import { MEMORY } from '../standard.mjs'

/** 一次召回的意图。 */
export const MEMORY_INTENTS = [
  'current_state',
  'low_info',
  'recent_context',
  'time_window',
  'correction',
  'long_term',
  'recent_topic'
]

/**
 * 纠错：对方在纠正你记错的事，需要更多证据，不能只给一条就下结论。
 * 「不是」只认指向上一轮的否定：主语是「你」，且带刚才/上次等时间词或跟说/提/讲等动词。
 * 像「不是今天，是明天」这种正常对比表达不算纠错，避免把召回窗口无谓放大。
 */
const CORRECTION_PATTERN =
  /(记错|记反|说错|你(?:刚才|刚刚|之前|前面|上次|昨天|今天)?不是(?:说|提|讲)?(?:过|了)?|你不是(?:说|提|讲|记得)(?:过|了)?|你(?:刚才|刚刚|之前|前面|上次|昨天|今天)?没说(?:过|了)?|我跟你说过|我没说过|你忘了|忘了[？?]|之前就说过|纠正一下|我说的是|我什么时候说)/

/** 很久以前：明确要翻旧账，窗口给到最大。 */
const LONG_TERM_PATTERN = /(以前|很久以前|最早|当初|最开始|一直以来|我们认识|还记得|你还记得|那时候)/

/** 时间窗口：限定在某个区间里找，靠条数覆盖不住，要放宽窗口。 */
const TIME_WINDOW_PATTERN =
  /(这周|上周|这个月|上个月|最近几天|最近三天|这几天|前两天|前天|昨天|上次|那次|刚才说|前面说|刚刚说)/

/**
 * 当下状态：只关心此刻，窗口收窄。
 * 「在忙」必须带主语「你」才算在问她：只认「你在忙 / 你忙不忙」，
 * 「我在忙，晚点说」是对方自述，不该把召回收窄到当下。
 */
const CURRENT_STATE_PATTERN =
  /(在干嘛|干嘛呢|忙什么|你在忙|你忙不忙|在做什么|干什么呢|你在哪|吃了吗|睡了吗|今天怎么样|今天过得|现在几点)/

/**
 * 指代与承接：接着刚才的话说，只看最近上下文。
 * 「这个 / 那个 / 它」只在后面直接跟标点或结束时才算承接；
 * 「这个项目怎么部署」是名词短语，不是指代上文。
 */
const REFER_PATTERN =
  /^(?:继续|然后呢|后来呢|所以呢|那呢|还有呢|接着说|往下说|说下去|(?:这个|那个|它)(?=[。.!！?？~～…，,、：:；;\s]|$))/

/** 低信息：一声应答或一句招呼，不该拖出一整本记忆。 */
const LOW_INFO_PATTERN =
  /^(嗯+|哦+|噢+|啊+|哈+|呵+|好|好的|行|可以|对|是|在吗|在不在|收到|ok)[。.!！?？~～…\s]*$/i

/**
 * 每种意图的召回策略。
 *
 * memoryCount 是原文摘要的基准条数；factCount 是结构化断言的基准条数。
 * 两个数都会在 memoryRecallPlan 里按 standard 的 recallPlan 投影到可注入区间：
 * 意图决定「该多宽」，标准决定「最多能有多宽」。
 */
const PLANS = {
  current_state: {
    memoryCount: 8,
    factCount: 4,
    preferRecent: true,
    note: '只关心此刻，别翻很久以前的事'
  },
  low_info: {
    memoryCount: 6,
    factCount: 3,
    preferRecent: true,
    note: '对方只是应了一声，不用主动展开'
  },
  recent_context: {
    memoryCount: 16,
    factCount: 6,
    preferRecent: true,
    note: '接着刚才的话说，别换话题'
  },
  time_window: {
    memoryCount: 24,
    factCount: 8,
    preferRecent: false,
    note: '对方限定了时间范围，按范围找'
  },
  correction: {
    memoryCount: 24,
    factCount: 12,
    preferRecent: false,
    note: '对方在纠正你，先看证据再改口'
  },
  long_term: {
    memoryCount: 40,
    factCount: 10,
    preferRecent: false,
    note: '对方在翻旧账，窗口放宽'
  },
  recent_topic: {
    memoryCount: 24,
    factCount: 8,
    preferRecent: true,
    note: ''
  }
}

/**
 * 判断这句话要哪一类记忆。
 *
 * 优先级按「判错代价」排：纠错最不能错，其次是明确的旧事与时间窗，
 * 然后是当下状态，最后才是普通承接。
 */
export function classifyMemoryIntent(text) {
  const source = typeof text === 'string' ? text.trim() : ''
  if (source === '') return { intent: 'low_info', reason: 'empty' }
  if (CORRECTION_PATTERN.test(source)) return { intent: 'correction', reason: 'correction' }
  if (LONG_TERM_PATTERN.test(source)) return { intent: 'long_term', reason: 'long_term' }
  if (TIME_WINDOW_PATTERN.test(source)) return { intent: 'time_window', reason: 'time_window' }
  if (CURRENT_STATE_PATTERN.test(source)) return { intent: 'current_state', reason: 'current_state' }
  if (LOW_INFO_PATTERN.test(source)) return { intent: 'low_info', reason: 'low_info' }
  if (REFER_PATTERN.test(source)) return { intent: 'recent_context', reason: 'reference' }
  return { intent: 'recent_topic', reason: 'default' }
}

/** 把基准条数投影到标准区间；非有限值按最小值处理，避免 NaN 传进注入层。 */
function projectCount(base, scale, min, max) {
  const raw = Number(base) * Number(scale)
  if (!Number.isFinite(raw)) return min
  return Math.min(max, Math.max(min, Math.round(raw)))
}

/** 单独取某种意图的策略；未知意图按默认处理。 */
export function memoryRecallPlan(intent) {
  // 必须查自有属性：'__proto__' 这类键会命中原型链，返回一个没有策略字段的脏对象。
  const known =
    typeof intent === 'string' && Object.prototype.hasOwnProperty.call(PLANS, intent)
  const plan = known ? PLANS[intent] : PLANS.recent_topic
  const budget = MEMORY.recallPlan
  return {
    intent: known ? intent : 'recent_topic',
    ...plan,
    memoryCount: projectCount(plan.memoryCount, budget.memoryScale, budget.memoryMin, budget.memoryMax),
    factCount: projectCount(plan.factCount, budget.factScale, budget.factMin, budget.factMax),
  }
}

/**
 * 按人格轴灵敏度再投影一次：意图给方向，轴只改幅度，上限仍由标准守住。
 * 非有限灵敏度按 1 处理，避免 UI 传入坏值时把注入条数清零或放大。
 */
export function scaleRecallPlan(plan, sensitivity = 1) {
  const budget = MEMORY.recallPlan
  const factor = Number.isFinite(Number(sensitivity)) ? Math.max(budget.sensitivityMin, Number(sensitivity)) : 1
  const memoryCount = Number.isFinite(Number(plan?.memoryCount)) ? Number(plan.memoryCount) : budget.memoryMin
  const factCount = Number.isFinite(Number(plan?.factCount)) ? Number(plan.factCount) : budget.factMin
  return {
    ...plan,
    memoryCount: Math.min(budget.memoryMax, Math.max(budget.countFloor, Math.round(memoryCount * factor))),
    factCount: Math.min(MEMORY.factsLimit, Math.max(budget.countFloor, Math.round(factCount * factor))),
  }
}

/**
 * 一句话 → 一份召回计划。
 *
 * 返回结构固定，调用方不用再判断 intent 是否存在。
 */
export function planMemoryRecall(text) {
  const classified = classifyMemoryIntent(text)
  const plan = memoryRecallPlan(classified.intent)
  return {
    intent: plan.intent,
    reason: classified.reason,
    memoryCount: plan.memoryCount,
    factCount: plan.factCount,
    preferRecent: plan.preferRecent,
    note: plan.note
  }
}

/**
 * 给诊断用的一句话：为什么这次取这么多。
 *
 * 只写进日志，不进提示词——模型不需要知道召回策略。
 */
export function describeRecallPlan(plan) {
  if (plan === null || typeof plan !== 'object') return ''
  const intent = typeof plan.intent === 'string' ? plan.intent : 'recent_topic'
  const memoryCount = Number.isFinite(plan.memoryCount) ? plan.memoryCount : 0
  const factCount = Number.isFinite(plan.factCount) ? plan.factCount : 0
  return `${intent}（原文 ${memoryCount} 条 / 断言 ${factCount} 条）`
}
