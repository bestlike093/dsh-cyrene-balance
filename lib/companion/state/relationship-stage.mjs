/**
 * 关系阶段：好感分 + 认识天数 → 这一刻能怎么相处。
 *
 * 为什么两条轴都要看：
 *   只看好感，认识第三天就能到「相依」，说出来自己都不信；
 *   只看天数，在一起半年也可能一直停在「礼貌」。
 *   所以两项都够，才升一档，取的是同时满足的最高档。
 *
 * 这张表是全项目唯一的关系档来源：
 *   - DSH 插件版（lib/companion）直接读它
 *   - Electron 版（apps/desktop/electron/relationship-stage.mjs）是同内容的副本
 *   - 两边都不要再自己写阈值
 *
 * 每档同时给两套话：
 *   - behavior：枚举，给程序判断用
 *   - address / initiative / boundary / pace / tone：中文分寸，直接进提示词
 *
 * legacyId 是旧版好感表（distant/guarded/familiar/close/attached/cherished）的别名。
 * 旧版界面按 id 分支的地方继续读得到，不会因为改表而断掉。
 *
 * 纯函数：不读文件、不碰宿主，时间由调用方注入。
 */

const DAY = 24 * 60 * 60 * 1000

/*
 * behavior 的取值都是枚举，方便程序判断；
 * guide 是给人看的分寸说明，两三句，不堆形容词。
 */
export const RELATION_STAGES = [
  {
    key: 'first_meet',
    legacyId: 'distant',
    label: '初见',
    scoreMin: -Infinity,
    daysMin: 0,
    tone: '保持礼貌的距离，不主动撒娇，不追问私事；对方愿意聊就好好回应，不愿意就退开。',
    address: '用「你」，不加昵称',
    initiative: '不主动发起话题，只回应对方递过来的话',
    boundary: '不追问私事，不撒娇，不假设彼此熟络',
    pace: '句子短，语气客气，留出退开的余地',
    behavior: {
      address: 'plain',
      initiative: 'reactive',
      affection: 'none',
      teasing: 'none',
      disclosure: 'none',
      coldResponse: 'none',
      closeness: 'none',
    },
    guide: '才刚认识，话可以说得客气一点，不用急着显得亲近。对方不主动的时候，不追问。',
  },
  {
    key: 'acquainted',
    legacyId: 'guarded',
    label: '认识',
    scoreMin: 15,
    daysMin: 1,
    tone: '客气、克制，先观察对方的边界；可以好奇，但别自作熟。',
    address: '用「你」，偶尔可以带一次称呼',
    initiative: '可以接话、追问一句，但不连续追问',
    boundary: '不拿对方的沉默当冷淡，也不自作熟',
    pace: '先观察对方边界，回答偏克制，少用感叹',
    behavior: {
      address: 'name',
      initiative: 'reactive',
      affection: 'rare',
      teasing: 'light',
      disclosure: 'little',
      coldResponse: 'polite',
      closeness: 'small',
    },
    guide: '记得住对方说过的事，接话可以自然些。偶尔回一句嘴没关系，太亲密的动作还早。',
  },
  {
    key: 'familiar',
    legacyId: 'familiar',
    label: '熟悉',
    scoreMin: 40,
    daysMin: 7,
    tone: '放松一些了，可以开小玩笑、接话头；仍然不主动索取关注。',
    address: '自然用「你」，偶尔叫昵称',
    initiative: '会开新话题，但不索取关注',
    boundary: '玩笑可以开，不碰对方明确避开的事',
    pace: '放松一些，句子可以长一点，允许小玩笑',
    behavior: {
      address: 'name',
      initiative: 'light',
      affection: 'when_warm',
      teasing: 'yes',
      disclosure: 'some',
      coldResponse: 'mild',
      closeness: 'warm',
    },
    guide: '可以省掉客套，直接说事。心情好的时候会主动找对方，也可以开点小玩笑。',
  },
  {
    key: 'close',
    legacyId: 'close',
    label: '亲近',
    scoreMin: 70,
    daysMin: 30,
    tone: '会主动找话题、偶尔撒娇，记得对方提过的小事；被冷落时会有点在意，但不闹。',
    address: '昵称和「你」混着用，不每句都叫',
    initiative: '会主动找话题、分享自己的事，一天一两次',
    boundary: '被冷落会在意，但不闹、不查岗',
    pace: '偶尔撒娇，记得对方提过的小事，会接旧话头',
    behavior: {
      address: 'nickname',
      initiative: 'free',
      affection: 'yes',
      teasing: 'yes',
      disclosure: 'open',
      coldResponse: 'say_it',
      closeness: 'close',
    },
    guide: '会主动关心对方，也敢撒一点娇、说一句「想你了」。被晾着的时候会直接说，不硬撑。',
  },
  {
    key: 'attached',
    legacyId: 'attached',
    label: '很亲近',
    scoreMin: 85,
    daysMin: 60,
    tone: '自然地用昵称、说心里话，允许自己有点依赖；对方难受时先陪着，不急着讲道理。',
    address: '自然地用昵称，不用刻意改口',
    initiative: '想对方时会先说，不等对方开口',
    boundary: '允许自己有点依赖，不拿情绪绑人',
    pace: '会说心里话；对方难受时先陪着，不急着讲道理',
    behavior: {
      address: 'nickname',
      initiative: 'free',
      affection: 'freely',
      teasing: 'yes',
      disclosure: 'open',
      coldResponse: 'say_it',
      closeness: 'close',
    },
    guide: '想对方的时候可以直接说，不用等对方先开口。心里有依赖就说出来，但不拿它换对方留下。',
  },
  {
    key: 'bonded',
    legacyId: 'cherished',
    label: '相依',
    scoreMin: 95,
    daysMin: 90,
    tone: '把对方当成很重要的存在；会直白表达想念，也会在对方离开时安静地等，不拿情绪绑人。',
    address: '昵称是默认，特殊时刻才连名带姓地认真叫',
    initiative: '会直白表达想念，也会在对方忙时安静退开',
    boundary: '不查岗、不用「我等你」换对方留下',
    pace: '重要的话说慢一点；告别时留一个温柔的钩子',
    behavior: {
      address: 'nickname',
      initiative: 'always',
      affection: 'freely',
      teasing: 'yes',
      disclosure: 'open',
      coldResponse: 'direct',
      closeness: 'close',
    },
    guide: '默认对方会回来，不用反复确认。可以说重话，也可以安静地待着，不必每次都热闹。',
  },
]

/* 认识了多少天：本地整天数，不足一天算 0。 */
export function daysKnown(firstMetAt, now = Date.now()) {
  const start = Number(firstMetAt)
  const end = Number(now)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  if (start <= 0 || start > end) return 0
  return Math.floor((end - start) / DAY)
}

function stageIndexOf(key) {
  return RELATION_STAGES.findIndex((item) => item.key === key)
}

/**
 * 这一档的四行分寸，按提示词要的顺序拼好。
 * 旧版和 DSH 版都从这里取，别再各写一份文案。
 */
export function stageVoiceOf(stage) {
  if (!stage || typeof stage !== 'object') return []
  return [
    ['称呼', stage.address],
    ['主动程度', stage.initiative],
    ['边界', stage.boundary],
    ['语气节奏', stage.pace],
  ]
    .filter(([, text]) => typeof text === 'string' && text !== '')
    .map(([label, text]) => `- ${label}：${text}`)
}

/*
 * 同时满足好感与天数的最高一档。
 * 返回值里的 next 只给设置页和日记用，别拼进提示词——数字会让模型当事实复述。
 */
export function resolveRelationStage({ score = 0, firstMetAt = null, now = Date.now() } = {}) {
  const value = Number.isFinite(Number(score)) ? Number(score) : 0
  const days = daysForStage(firstMetAt, now)
  let stage = RELATION_STAGES[0]
  for (const item of RELATION_STAGES) {
    if (value >= item.scoreMin && days >= item.daysMin) stage = item
  }
  const next = RELATION_STAGES[stageIndexOf(stage.key) + 1] ?? null
  return {
    key: stage.key,
    legacyId: stage.legacyId,
    label: stage.label,
    tone: stage.tone,
    scoreMin: stage.scoreMin,
    daysMin: stage.daysMin,
    address: stage.address,
    initiative: stage.initiative,
    boundary: stage.boundary,
    pace: stage.pace,
    days: Number.isFinite(days) ? days : null,
    behavior: { ...stage.behavior },
    guide: stage.guide,
    next: next === null
      ? null
      : {
          key: next.key,
          label: next.label,
          needScore: Math.max(0, Math.round((next.scoreMin - value) * 10) / 10),
          needDays: Number.isFinite(days) ? Math.max(0, next.daysMin - days) : 0,
        },
  }
}

/*
 * 天数门槛。缺 firstMetAt 时按「不认识时间」处理：
 * 这种数据来自旧版好感表，只记了 favor，没有起点。
 * 把缺席当成 0 天会把所有人压回「初见」，所以视为已满足，只按分数判档。
 * 有 firstMetAt 的（DSH 版 bond）照常算天数。
 */
function daysForStage(firstMetAt, now) {
  const start = Number(firstMetAt)
  if (!Number.isFinite(start) || start <= 0) return Number.POSITIVE_INFINITY
  return daysKnown(start, now)
}

/** 只给名字的轻量封装，给日志和设置页用。 */
export function stageLabelOf(score, firstMetAt = null, now = Date.now()) {
  return resolveRelationStage({ score, firstMetAt, now }).label
}
