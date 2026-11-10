/**
 * 日程骨架：用本地钟自己转，不依赖 DSH 是否开着。
 *
 * DSH 只提供只读锚点（sessionId / startedAt / lastMessageAt / turnCount），
 * 用来判断「今天忙到几点」「一起干了多久」；日程本身不写回 DSH。
 * 时间统一用 epoch ms，落盘不存字符串；显示与日程都按人格时区转。
 */

import { personaDay } from '../persona/persona-time.mjs'

export const SCHEDULE_VERSION = 1

/* 上海没有夏令时，固定 UTC+8；日历日与时分都走 persona-time，机器换时区也不跟着漂。 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

/* 一天里的固定节点。text 是主动开口时可以直接用的一句话。 */
export const DEFAULT_SCHEDULE = [
  { id: 'wake', at: '07:30', text: '该起来啦，先喝口水。' },
  { id: 'breakfast', at: '08:30', text: '早饭吃了吗？别空着肚子。' },
  { id: 'lunch', at: '12:00', text: '到饭点了，先吃饭吧。' },
  { id: 'afternoon', at: '14:30', text: '下午继续，别一直坐着。' },
  { id: 'dinner', at: '18:30', text: '晚饭时间到啦。' },
  { id: 'rest', at: '21:30', text: '忙完了就歇一会儿吧。' },
  { id: 'sleep', at: '23:30', text: '夜深了，早点睡。' }
]

function parseClock(value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/* 取 now 在人格时区的日历日，不读机器本地时区。 */
function shanghaiDay(now) {
  return personaDay(now)
}

/* 上海固定 UTC+8，把墙上的时分换算回 epoch ms。 */
function shanghaiEpoch(day, hour, minute) {
  return Date.UTC(day.year, day.month - 1, day.day, hour, minute, 0, 0) - SHANGHAI_OFFSET_MS
}

/**
 * 今天（或给定时刻所在那天）的日程节点，返回给 opening.pickCue 的 agenda。
 * 每个节点都带 epoch ms 与当天唯一的 key，跨天不会把昨天的开口当成今天。
 */
export function scheduleAgenda(now = Date.now(), entries = DEFAULT_SCHEDULE) {
  if (Number.isNaN(new Date(now).getTime()) || !Array.isArray(entries)) return []
  const day = shanghaiDay(now)
  if (day === null) return []
  const agenda = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue
    const clock = parseClock(entry.at)
    if (clock === null) continue
    agenda.push({
      at: shanghaiEpoch(day, clock.hour, clock.minute),
      text: typeof entry.text === 'string' ? entry.text : '',
      key: `schedule:${typeof entry.id === 'string' && entry.id !== '' ? entry.id : clock.hour + ':' + clock.minute}:${day.key}`
    })
  }
  return agenda.sort((a, b) => a.at - b.at)
}

/**
 * DSH 侧的只读锚点。字段缺失或不是有限数字时返回 null，不猜。
 * turnCount 只用于「一起干了多久」，不反向写回 DSH。
 */
export function sessionAnchor(input) {
  if (input === null || typeof input !== 'object') return null
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
  const startedAt = Number(input.startedAt)
  const lastMessageAt = Number(input.lastMessageAt)
  const turnCount = Number(input.turnCount)
  if (sessionId === '') return null
  if (!Number.isFinite(startedAt) || !Number.isFinite(lastMessageAt) || !Number.isFinite(turnCount)) return null
  return {
    sessionId,
    startedAt,
    lastMessageAt,
    turnCount: Math.max(0, Math.floor(turnCount)),
    durationMs: Math.max(0, lastMessageAt - startedAt)
  }
}
