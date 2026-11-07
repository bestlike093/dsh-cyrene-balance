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

/** 纠错：对方在纠正你记错的事，需要更多证据，不能只给一条就下结论。 */
const CORRECTION_PATTERN =
  /(记错|记反|说错|不是.{0,8}是|我跟你说过|我没说过|你忘了|忘了[？?]|之前就说过|纠正一下|我说的是|我什么时候说)/

/** 很久以前：明确要翻旧账，窗口给到最大。 */
const LONG_TERM_PATTERN = /(以前|很久以前|最早|当初|最开始|一直以来|我们认识|还记得|你还记得|那时候)/

/** 时间窗口：限定在某个区间里找，靠条数覆盖不住，要放宽窗口。 */
const TIME_WINDOW_PATTERN =
  /(这周|上周|这个月|上个月|最近几天|最近三天|这几天|前两天|前天|昨天|上次|那次|刚才说|前面说|刚刚说)/

/** 当下状态：只关心此刻，窗口收窄。 */
const CURRENT_STATE_PATTERN =
  /(在干嘛|干嘛呢|忙什么|在忙|在做什么|干什么呢|你在哪|吃了吗|睡了吗|今天怎么样|今天过得|现在几点)/

/** 指代与承接：接着刚才的话说，只看最近上下文。 */
const REFER_PATTERN = /^(继续|然后呢|后来呢|所以呢|那呢|这个|那个|它|还有呢|接着说|往下说|说下去)/

/** 低信息：一声应答或一句招呼，不该拖出一整本记忆。 */
const LOW_INFO_PATTERN =
  /^(嗯+|哦+|噢+|啊+|哈+|呵+|好|好的|行|可以|对|是|在吗|在不在|收到|ok)[。.!！?？~～…\s]*$/i

/**
 * 每种意图的召回策略。
 *
 * memoryCount 控制原文摘要的条数；factCount 控制结构化断言的条数。
 * 断言比原文更省 token，也更稳，所以「当下」类问题把额度多给断言。
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

/** 单独取某种意图的策略；未知意图按默认处理。 */
export function memoryRecallPlan(intent) {
  const plan = PLANS[intent] ?? PLANS.recent_topic
  return { intent: PLANS[intent] ? intent : 'recent_topic', ...plan }
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
