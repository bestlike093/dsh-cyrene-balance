/*
 * 能力中心：石头剪刀布与本地战绩。
 *
 * 这一层只做纯计算，不碰文件、不碰窗口。宿主负责读写 ability.json，
 * 客户端只负责把结果画出来。战绩永远只存在本机。
 */

export const RPS_CHOICES = ['rock', 'paper', 'scissors']

export const RPS_LABELS = {
  rock: '石头',
  paper: '布',
  scissors: '剪刀',
}

const BEATS = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
}

export function defaultAbilityStats() {
  return {
    version: 1,
    total: 0,
    win: 0,
    lose: 0,
    draw: 0,
    streak: 0,
    bestStreak: 0,
    lastAt: null,
  }
}

function count(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.floor(number)
}

export function normalizeAbility(raw) {
  const stats = defaultAbilityStats()
  if (raw === null || typeof raw !== 'object') return stats
  stats.total = count(raw.total)
  stats.win = count(raw.win)
  stats.lose = count(raw.lose)
  stats.draw = count(raw.draw)
  stats.streak = count(raw.streak)
  stats.bestStreak = Math.max(count(raw.bestStreak), stats.streak)
  stats.lastAt = typeof raw.lastAt === 'string' && raw.lastAt !== '' ? raw.lastAt : null
  /* 旧文件或手改过的文件里，三项加起来可能不等于总场次；以实际计数为准。 */
  const counted = stats.win + stats.lose + stats.draw
  if (counted > stats.total) stats.total = counted
  return stats
}

export function isValidChoice(choice) {
  return RPS_CHOICES.includes(choice)
}

export function judge(user, pet) {
  if (!isValidChoice(user) || !isValidChoice(pet)) return null
  if (user === pet) return 'draw'
  return BEATS[user] === pet ? 'win' : 'lose'
}

/*
 * 一局的结果：
 *   win  = 你赢了她
 *   lose = 她赢了你
 *   draw = 平局
 * 连赢在输的时候清零，平局不打断连赢。
 */
export function playRound(stats, choice, now = Date.now(), random = Math.random) {
  if (!isValidChoice(choice)) return null
  const current = normalizeAbility(stats)
  const roll = Number(random())
  const index = Number.isFinite(roll) ? Math.min(2, Math.max(0, Math.floor(roll * 3))) : 0
  const pet = RPS_CHOICES[index]
  const result = judge(choice, pet)
  if (result === null) return null

  const next = { ...current, total: current.total + 1 }
  if (result === 'win') {
    next.win += 1
    next.streak += 1
    next.bestStreak = Math.max(next.bestStreak, next.streak)
  } else if (result === 'lose') {
    next.lose += 1
    next.streak = 0
  } else {
    next.draw += 1
  }
  next.lastAt = new Date(now).toISOString()

  return {
    stats: next,
    round: {
      user: choice,
      pet,
      result,
      at: next.lastAt,
    },
  }
}

export function summarizeAbility(stats) {
  const current = normalizeAbility(stats)
  const rate = current.total === 0 ? 0 : current.win / current.total
  let label = '还没交过手'
  if (current.total >= 1) label = '刚认识手气'
  if (current.total >= 10) label = '有点默契'
  if (current.total >= 30) label = '老对手了'
  return {
    total: current.total,
    win: current.win,
    lose: current.lose,
    draw: current.draw,
    streak: current.streak,
    bestStreak: current.bestStreak,
    winRate: Math.round(rate * 1000) / 10,
    label,
  }
}
