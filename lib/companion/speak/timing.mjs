/**
 * 主动开口的时机模型。
 *
 * 之前只有「隔了多久」一个维度：到点就说，没到点就不说。
 * 可人不是按定时器活着的——刚聊完两分钟又冒一句会很烦，
 * 人离开电脑一小时还对着空房间说话很怪，凌晨三点和下午三点的分寸也不该一样。
 *
 * 这里只做三件事，而且每一条都能用一句话解释：
 *
 *   刚聊完     —— 对方还在跟你说话，先让出这一拍
 *   人不在     —— 系统空闲很久了，话留着，等回来再说
 *   作息       —— 常活跃的时段可以早一点，深夜则明显晚一点
 *
 * 全部是纯函数，状态由调用方保存；读不懂的旧数据一律当作空作息，
 * 宁可少说一句，也不要因为一份坏文件把节奏弄乱。
 */

/** 时钟单位：一小时。 */
const HOUR_MS = 60 * 60 * 1000

/** 作息样本上限：到了就整体减半，让最近的作息压过旧习惯。 */
const RHYTHM_SAMPLE_CAP = 400

export const DEFAULT_TIMING_LIMITS = {
  /** 对方刚说完话，先安静这么久。 */
  minGapAfterUserMs: 90 * 1000,
  /** 系统空闲超过这么久，当作人不在。 */
  awayAfterMs: 20 * 60 * 1000,
  /** 常活跃时段：间隔缩到八成。 */
  activeHourScale: 0.8,
  /** 深夜：间隔拉长到一倍六。 */
  lateNightScale: 1.6,
  /** 一个小时至少攒过这么多条互动，才算「常活跃」。 */
  activeHourMinCount: 6,
  /** 总样本少于这个数时还不算认识作息，不做加减速。 */
  minSamplesForRhythm: 40,
  /** 深夜的判定边界。 */
  lateNightStartHour: 23,
  lateNightEndHour: 6
}

/** 空作息：24 个小时桶，全是 0。 */
export function emptyRhythm() {
  return { hours: Array(24).fill(0), samples: 0, updatedAt: 0 }
}

function asCount(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * 把任意输入整理成可用的作息。
 * 缺字段、负数、非数组都当作没有，不抛错，也不猜。
 */
export function normalizeRhythm(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const rawHours = Array.isArray(source.hours) ? source.hours : []
  const hours = Array.from({ length: 24 }, (_, index) => asCount(rawHours[index]))
  const samples = asCount(source.samples) || hours.reduce((sum, item) => sum + item, 0)
  const updatedAt = asCount(source.updatedAt)
  return { hours, samples, updatedAt }
}

/**
 * 记一次「对方开口」。
 *
 * 只记小时，不记具体内容；样本攒够一轮就整体减半，
 * 这样换了作息之后，旧习惯会慢慢退下去，而不是永远压着。
 */
export function recordActivity(rhythm, at = Date.now()) {
  const base = normalizeRhythm(rhythm)
  const stamp = Number.isFinite(Number(at)) ? Number(at) : Date.now()
  const hour = new Date(stamp).getHours()
  const hours = base.hours.slice()
  hours[hour] = asCount(hours[hour]) + 1

  let samples = base.samples + 1
  if (samples > RHYTHM_SAMPLE_CAP) {
    for (let index = 0; index < hours.length; index += 1) {
      hours[index] = Math.round(hours[index] / 2)
    }
    samples = Math.round(samples / 2)
  }

  return { hours, samples, updatedAt: stamp }
}

/**
 * 这一刻适合开口吗。
 *
 * 返回 { speak, reason, scale, hour, hourCount }。
 * speak 为 false 时，调用方应当安静过这一拍；scale 是间隔倍率，
 * 只在 speak 为 true 时有意义。
 */
export function assessTiming(options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const limits = { ...DEFAULT_TIMING_LIMITS, ...(options.limits ?? {}) }
  const lastUserSpokeAt = asCount(options.lastUserSpokeAt)
  const idleMs = Number.isFinite(Number(options.idleMs)) ? Math.max(0, Number(options.idleMs)) : null
  const rhythm = normalizeRhythm(options.rhythm)
  const hour = new Date(now).getHours()
  const hourCount = rhythm.hours[hour]

  // 对方刚说完话：这一轮还没结束，先别插嘴。
  if (lastUserSpokeAt > 0 && now - lastUserSpokeAt < limits.minGapAfterUserMs) {
    return { speak: false, reason: 'just_talked', scale: 1, hour, hourCount }
  }

  // 人不在电脑前：对着空房间说话没有意义，等他回来。
  if (idleMs !== null && idleMs >= limits.awayAfterMs) {
    return { speak: false, reason: 'user_away', scale: 1, hour, hourCount }
  }

  const lateNight =
    limits.lateNightStartHour >= limits.lateNightEndHour
      ? hour >= limits.lateNightStartHour || hour < limits.lateNightEndHour
      : hour >= limits.lateNightStartHour && hour < limits.lateNightEndHour

  // 样本不够就先按老规矩来，别用两三次互动猜人家的作息。
  if (rhythm.samples < limits.minSamplesForRhythm) {
    return {
      speak: true,
      reason: lateNight ? 'late_night' : 'neutral',
      scale: lateNight ? limits.lateNightScale : 1,
      hour,
      hourCount
    }
  }

  const average = rhythm.samples / 24
  const active =
    hourCount >= limits.activeHourMinCount && hourCount >= average * 0.8

  if (active) {
    return { speak: true, reason: 'active_hour', scale: limits.activeHourScale, hour, hourCount }
  }
  if (lateNight) {
    return { speak: true, reason: 'late_night', scale: limits.lateNightScale, hour, hourCount }
  }
  return { speak: true, reason: 'neutral', scale: 1, hour, hourCount }
}

/**
 * 给人看的一句话：设置页诊断用。
 * 只说此刻的判断，不解释整套规则。
 */
export function describeTiming(verdict) {
  if (verdict === null || typeof verdict !== 'object') return '还不清楚'
  if (verdict.speak !== true) {
    if (verdict.reason === 'just_talked') return '刚聊过，先不打扰'
    if (verdict.reason === 'user_away') return '人好像不在'
    return '先安静一会儿'
  }
  if (verdict.reason === 'active_hour') return '这个点常聊天，可以早一点'
  if (verdict.reason === 'late_night') return '夜深了，说得慢一点'
  return '平常的节奏'
}

export { HOUR_MS, RHYTHM_SAMPLE_CAP }
