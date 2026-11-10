/**
 * B 站浏览与受控互动。
 *
 * 适用范围要分清楚：
 * - 默认配置下 B 站只读，不点赞、不评论、不投币、不转发。
 *   这是行为约束，不写在这个包里。
 * - 桌宠项目（本包）不套用那条约束。它可以按使用者需求自由配置，
 *   默认仍是纯只读，写操作要逐项开启。
 *
 * 分档方式：
 * - 读动作（搜索、打开、简介、评论、相关推荐）永远允许
 * - 写动作（评论、点赞、收藏、投币、转发）默认全部关闭，必须显式列进策略
 * - 投币额外受数量上限约束
 *
 * 这一层不碰网络：它负责「认出链接、判定动作是否被允许、把简介拆成可用的结论」。
 * 真正抓页面、发请求由宿主完成，结果按这里的结构喂回来。
 */

/** 读动作集合。这些不需要开关，也不该被策略收紧。 */
export const READ_ONLY_ACTIONS = [
  'search',
  'open',
  'read-intro',
  'read-comments',
  'list-related'
]

/**
 * 写动作的元信息。
 *
 * 三项标记决定了开启后的提醒方式：
 * `reversible` 能否撤回、`costly` 是否消耗资产、`public` 是否对他人可见。
 * 三者都命中时（投币 + 公开），最该给二次确认。
 */
export const WRITE_ACTION_META = {
  like: { id: 'like', label: '点赞', reversible: true, costly: false, public: false },
  favorite: { id: 'favorite', label: '收藏', reversible: true, costly: false, public: false },
  comment: { id: 'comment', label: '评论', reversible: true, costly: false, public: true },
  share: { id: 'share', label: '转发', reversible: false, costly: false, public: true },
  coin: { id: 'coin', label: '投币', reversible: false, costly: true, public: true }
}

export const WRITE_ACTIONS = ['like', 'favorite', 'comment', 'share', 'coin']

/** B 站单次投币上限是 2 枚。这里再收一道，防止调用方传 10。 */
export const MAX_COIN_COUNT = 2

export const DEFAULT_BILIBILI_POLICY = {
  /** 已开启的写动作。空数组 = 纯只读。 */
  enabledWrites: [],
  /** 单次投币上限，默认 1，最大 2。 */
  maxCoinsPerAction: 1
}

export class BilibiliReadOnlyError extends Error {
  constructor(action) {
    super(`B 站只读模式，拒绝执行：${action}`)
    this.name = 'BilibiliReadOnlyError'
    this.action = action
  }
}

/** 写动作被策略关掉了。和「未知动作」分开，方便上层提示「去设置里开」。 */
export class BilibiliWriteDisabledError extends Error {
  constructor(action) {
    super(`B 站写操作未开启：${action}（${WRITE_ACTION_META[action].label}）`)
    this.name = 'BilibiliWriteDisabledError'
    this.action = action
  }
}

export class BilibiliCoinLimitError extends Error {
  constructor(requested, limit) {
    super(`投币数量超出上限：请求 ${requested}，上限 ${limit}`)
    this.name = 'BilibiliCoinLimitError'
    this.requested = requested
    this.limit = limit
  }
}

export function isReadOnlyAction(action) {
  return READ_ONLY_ACTIONS.includes(action)
}

export function isWriteAction(action) {
  return WRITE_ACTIONS.includes(action)
}

/** 只校验「是不是读动作」。写动作会抛，语义仍是「这不是读动作」。 */
export function assertReadOnly(action) {
  if (!isReadOnlyAction(action)) {
    throw new BilibiliReadOnlyError(action)
  }
}

/**
 * 动作总闸。
 *
 * 读动作直接放行；写动作必须出现在策略里。未知动作两头都不认，直接拒绝。
 * policy 缺省时用默认策略兜底（纯只读），避免调用方漏传时直接抛 TypeError。
 */
export function assertActionAllowed(action, policy = DEFAULT_BILIBILI_POLICY) {
  if (isReadOnlyAction(action)) return

  if (isWriteAction(action)) {
    if (!policy.enabledWrites.includes(action)) {
      throw new BilibiliWriteDisabledError(action)
    }
    return
  }

  throw new BilibiliReadOnlyError(action)
}

/** 投币前单独过一道数量检查。不传数量按 1 枚算。policy 缺省时用默认策略兜底。 */
export function assertCoinCount(count, policy = DEFAULT_BILIBILI_POLICY) {
  const limit = Math.min(policy.maxCoinsPerAction, MAX_COIN_COUNT)
  if (!Number.isInteger(count) || count < 1) {
    throw new BilibiliCoinLimitError(count, limit)
  }
  if (count > limit) {
    throw new BilibiliCoinLimitError(count, limit)
  }
}

/**
 * 这个动作要不要二次确认。
 *
 * 规则：不可撤回、或消耗资产、或对他人公开 —— 命中任一条就要。
 * 点赞和收藏两条都不沾，开了就能直接做。
 */
export function needsConfirmation(action) {
  const meta = WRITE_ACTION_META[action]
  // 未知动作没有元信息：不知道它可不可撤回，一律按需要确认处理，
  // 别在 meta.reversible 上抛 TypeError 让调用方误判成「安全」。
  if (meta === undefined) return true
  return !meta.reversible || meta.costly || meta.public
}

const BVID_PATTERN = /\bBV[0-9A-Za-z]{10}\b/

/** 从整段 URL 或裸 BV 号里取出 bvid；取不到返回 null。 */
export function parseVideoRef(input) {
  const match = BVID_PATTERN.exec(input)
  return match === null ? null : { bvid: match[0] }
}

const GITHUB_PATTERN = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g

/**
 * 从简介里抠 GitHub 仓库。
 *
 * 这是这次真正用得上的能力：简介里塞一个仓库链接，
 * 人工看要滚三屏，程序只要一次正则。去掉尾部标点，避免把「。」吃进仓库名。
 */
export function extractRepoRefs(text) {
  // 非字符串输入没有可抠的仓库，直接返回空列表，别让 matchAll 抛 TypeError。
  if (typeof text !== 'string') return []
  const seen = new Set()
  const refs = []

  for (const match of text.matchAll(GITHUB_PATTERN)) {
    const owner = match[1]
    const rawRepo = match[2]
    if (owner === undefined || rawRepo === undefined) continue

    const repo = rawRepo.replace(/[.,;:)\]}]+$/, '')
    const url = `https://github.com/${owner}/${repo}`
    if (seen.has(url)) continue

    seen.add(url)
    refs.push({ owner, repo, url })
  }

  return refs
}

/** 简介里常见的「先说实话」「已知边界」段落，单独摘出来。 */
const LIMIT_KEYWORDS = ['已知边界', '局限', '限制', '做不到', '还差', '只是能跑', '先说']

/**
 * 把一条视频的简介压成摘要。
 *
 * 不判断内容好不好，只做三件事：认出仓库、摘出边界、保留原文。
 * 判断留给上层，避免这里掺进主观结论。
 */
export function digestVideo(meta) {
  // description/url 可能缺字段或类型不对：按空处理，别让 .trim() 在 undefined 上抛错。
  const body = typeof meta.description === 'string' ? meta.description.trim() : ''
  const ref = typeof meta.url === 'string' ? parseVideoRef(meta.url) : null

  const limits = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => LIMIT_KEYWORDS.some((keyword) => line.includes(keyword)))

  return {
    title: meta.title,
    ...(ref === null ? {} : { bvid: ref.bvid }),
    repos: extractRepoRefs(body),
    limits,
    body
  }
}

/** 摘要是否值得进一步看：抓到仓库，或作者自己写了边界。 */
export function isWorthFollowing(digest) {
  return digest.repos.length > 0 || digest.limits.length > 0
}
