#!/usr/bin/env node
/**
 * 换前基线：主动开口链 24 小时快照。
 *
 * 目的：换 pickCandidate 之前，把「现在这条链」的行为钉成可 diff 的 JSON。
 * 固定 fixture + 固定采样点 + 固定伪随机，换后同命令重跑，差异只应来自预期项。
 *
 * 两条链同 fixture 并排跑：
 *   schedule —— 现状：scheduleAgenda 七时刻 → pickCue（含 quota / gap / 抖动）
 *   plan     —— 目标：固定段表 → pickCandidate（外挂同一套 quota / gap，标注为外闸）
 *
 * 口径声明：
 * - 采样点用 UTC+8 固定构造，不读机器当前时区；
 * - pickCue 的 dayOf 是 personaDayKey，scheduleAgenda 的 key 也是 personaDayKey，
 *   开口链内部同源；daily-plan / agenda-runtime 的日期键是本地时间，不在本脚本范围；
 * - pickCandidate 的 segmentAt 用 minuteOfDay（本地），段表 startMinute 是墙钟分钟；
 *   机器不在 UTC+8 时两者会平移，本脚本当前机器在 UTC+8，故重合；
 * - 时段闸（23:00–08:00）属于外壳层；脚本按真机口径复刻这一道，
 *   在进 pickCue / pickCandidate 之前跳过，否则第一次采样就会把额度用光。
 *
 * 用法：
 *   node scripts/agenda-baseline.mjs
 *   node scripts/agenda-baseline.mjs --out scripts/baselines/custom.json
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_SCHEDULE, scheduleAgenda } from '../lib/companion/time/schedule.mjs'
import {
  defaultLedger,
  normalizeLedger,
  openingsToday,
  pickCue,
  recordOpening,
} from '../lib/companion/speak/opening.mjs'
import { bubbleTone } from '../lib/companion/voice-out/bubble-tone.mjs'
import { personaDayKey, personaHour } from '../lib/companion/persona/persona-time.mjs'
import { pickCandidate } from '../pet/standalone/packages/core/dist/companion/candidates.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/* 2026-11-10 00:00 +08:00。固定，不读机器时钟。 */
const BASE = Date.UTC(2026, 10, 9, 16, 0, 0, 0)
const STEP_MS = 5 * 60 * 1000
const SAMPLES = (24 * 60) / 5
const HOUR = 60 * 60 * 1000

const DAILY_CAP = 3
const MIN_GAP_MS = 90 * 60 * 1000
const JITTER = 0.15
const WARMTH = 0.6

/* 三条固定记忆，权重刚好过 0.6 的池门槛 */
const FIXTURE_MEMORIES = [
  { text: '你说过喜欢雨天', weight: 0.82, key: 'memory:rain' },
  { text: '那家开在坡上的书店', weight: 0.71, key: 'memory:bookstore' },
  { text: '你答应过要早点睡', weight: 0.65, key: 'memory:sleep-early' },
]

/* 固定段表：11 段覆盖 24h，含 sleep、meal、memo 空与非空两种 */
const FIXTURE_SEGMENTS = [
  { id: 'sleep', startMinute: 0, endMinute: 420, title: '睡觉', kind: 'sleep', memo: '' },
  { id: 'wake', startMinute: 420, endMinute: 480, title: '起床', kind: 'rest', memo: '慢慢醒过来' },
  { id: 'breakfast', startMinute: 480, endMinute: 540, title: '吃早饭', kind: 'meal', memo: '' },
  { id: 'focus', startMinute: 540, endMinute: 720, title: '做自己的事', kind: 'work', memo: '把昨天没写完的收个尾' },
  { id: 'lunch', startMinute: 720, endMinute: 780, title: '午饭', kind: 'meal', memo: '' },
  { id: 'nap', startMinute: 780, endMinute: 840, title: '小睡', kind: 'rest', memo: '' },
  { id: 'chores', startMinute: 840, endMinute: 1080, title: '下午的琐事', kind: 'chore', memo: '' },
  { id: 'dinner', startMinute: 1080, endMinute: 1140, title: '晚饭', kind: 'meal', memo: '' },
  { id: 'evening', startMinute: 1140, endMinute: 1320, title: '闲下来', kind: 'leisure', memo: '翻了会儿旧相册' },
  { id: 'wash', startMinute: 1320, endMinute: 1380, title: '洗漱', kind: 'rest', memo: '' },
  { id: 'night', startMinute: 1380, endMinute: 1440, title: '准备睡', kind: 'sleep', memo: '' },
]

/** 固定伪随机：同一种子同一条序列，基线可复现。 */
function mulberry32(seed) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d2b79f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* pickCue 的抖动是公开函数，这里复刻同一式子给 pickCandidate 算冷却外闸。 */
function jitterOf(seed, span = JITTER) {
  const x = Math.sin(Number(seed) || 0) * 10000
  const unit = x - Math.floor(x)
  return 1 - span + unit * span * 2
}

function isoAt(epoch) {
  const date = new Date(epoch + 8 * HOUR)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:00+08:00`
}

function clockAt(epoch) {
  return isoAt(epoch).slice(11, 16)
}

function gapBuckets(gaps) {
  const buckets = {
    'lt60': 0,
    '60to90': 0,
    '90to120': 0,
    '120to150': 0,
    '150to180': 0,
    'gte180': 0,
  }
  for (const gap of gaps) {
    const minutes = gap / 60000
    if (minutes < 60) buckets.lt60 += 1
    else if (minutes < 90) buckets['60to90'] += 1
    else if (minutes < 120) buckets['90to120'] += 1
    else if (minutes < 150) buckets['120to150'] += 1
    else if (minutes < 180) buckets['150to180'] += 1
    else buckets.gte180 += 1
  }
  return buckets
}

function summarize(events, totalSamples, extra = {}) {
  const byKind = {}
  for (const event of events) {
    const kind = event.kind ?? 'unknown'
    byKind[kind] = (byKind[kind] ?? 0) + 1
  }
  const gaps = []
  for (let index = 1; index < events.length; index += 1) {
    gaps.push(events[index].at - events[index - 1].at)
  }
  return {
    samples: totalSamples,
    opened: events.length,
    byKind,
    ratios: Object.fromEntries(
      Object.entries(byKind).map(([kind, count]) => [kind, Number((count / Math.max(1, events.length)).toFixed(4))])
    ),
    gapsMs: gaps,
    gapBuckets: gapBuckets(gaps),
    quietHourOpened: events.filter((event) => event.inQuietHours).length,
    sleepSegmentOpened: events.filter((event) => event.sleepSegment === true).length,
    ...extra,
  }
}

/* ---------------- schedule 链：七时刻 → pickCue ---------------- */

function runSchedule() {
  const events = []
  let ledger = defaultLedger(BASE)
  let gateSkipped = 0
  const random = mulberry32(0x5eed2026)
  const options = {
    minGapMs: MIN_GAP_MS,
    dailyCap: DAILY_CAP,
    unansweredLimit: 3,
    silenceDays: 3,
    quiet: false,
    jitter: JITTER,
    random,
  }

  for (let index = 0; index < SAMPLES; index += 1) {
    const now = BASE + index * STEP_MS
    const hour = personaHour(now)
    if (hour >= 23 || hour < 8) {
      gateSkipped += 1
      continue
    }
    const agenda = scheduleAgenda(now, DEFAULT_SCHEDULE)
    const lastTalkAt = BASE - 10 * HOUR
    const unfinished = [{ text: '上次说到的那本书', lastAt: BASE + 9 * HOUR }]

    const usedTodayBefore = openingsToday(ledger, now)
    const cue = pickCue({
      now,
      agenda,
      unfinished,
      lastTalkAt,
      memories: FIXTURE_MEMORIES,
      ledger,
      options,
    })
    if (cue === null) continue

    const baseText = typeof cue.text === 'string' ? cue.text : ''
    const toned = bubbleTone(baseText, { warmth: WARMTH })
    ledger = recordOpening(ledger, cue, now)

    events.push({
      at: now,
      iso: isoAt(now),
      clock: clockAt(now),
      day: personaDayKey(now),
      hour,
      inQuietHours: false,
      kind: cue.kind,
      key: cue.key,
      reason: cue.reason,
      baseText,
      toned,
      toneChanged: toned !== baseText,
      textEmpty: baseText === '',
      sleepSegment: typeof cue.key === 'string' && cue.key.includes(':sleep:'),
      usedTodayBefore,
      quota: DAILY_CAP,
    })
  }

  return {
    summary: summarize(events, SAMPLES, {
      gateSkipped,
      ledgerKeys: [...new Set(normalizeLedger(ledger, BASE + 24 * HOUR).entries.map((entry) => entry.key))],
      claims: 'not-wired',
      source: 'schedule-7',
      agendaSegments: DEFAULT_SCHEDULE.length,
      quotaTouches: events.filter((event) => event.usedTodayBefore >= DAILY_CAP - 1).length,
    }),
    events,
  }
}

/* ---------------- plan 链：固定段表 → pickCandidate ---------------- */

function runPlan() {
  const events = []
  const claimed = []
  const entries = []
  let lastOpenAt = null
  let gateSkipped = 0
  const plan = { date: personaDayKey(BASE), segments: FIXTURE_SEGMENTS }

  for (let index = 0; index < SAMPLES; index += 1) {
    const now = BASE + index * STEP_MS
    const hour = personaHour(now)
    if (hour >= 23 || hour < 8) {
      gateSkipped += 1
      continue
    }
    const usedTodayBefore = entries.filter((entry) => personaDayKey(entry.at) === personaDayKey(now)).length
    if (usedTodayBefore >= DAILY_CAP) continue

    const cooldownUntil =
      lastOpenAt === null ? undefined : lastOpenAt + Math.round(MIN_GAP_MS * jitterOf(lastOpenAt))
    if (typeof cooldownUntil === 'number' && now < cooldownUntil) continue

    const candidate = pickCandidate({
      now,
      agenda: plan,
      asleep: false,
      quiet: false,
      tired: false,
      cooldownUntil,
      claimedSegmentIds: claimed,
      lastUserAt: BASE - 10 * HOUR,
      absenceAfterMs: 3 * 24 * HOUR,
      thought: null,
      loop: null,
    })
    if (candidate === null) continue

    const baseText = candidate.note
    const toned = bubbleTone(baseText, { warmth: WARMTH })
    lastOpenAt = now
    if (candidate.segmentId !== null) claimed.push(candidate.segmentId)
    entries.push({ at: now, kind: candidate.kind, key: `agenda:${candidate.segmentId}`, responded: false })

    const segment = FIXTURE_SEGMENTS.find((item) => item.id === candidate.segmentId) ?? null
    events.push({
      at: now,
      iso: isoAt(now),
      clock: clockAt(now),
      day: personaDayKey(now),
      hour,
      inQuietHours: false,
      kind: candidate.kind,
      key: `agenda:${candidate.segmentId}`,
      reason: candidate.reason,
      segmentId: candidate.segmentId,
      segmentKind: segment?.kind ?? '',
      segmentStart: segment?.startMinute ?? null,
      baseText,
      toned,
      toneChanged: toned !== baseText,
      textEmpty: baseText === '',
      sleepSegment: segment?.kind === 'sleep',
      usedTodayBefore,
      quota: DAILY_CAP,
    })
  }

  return {
    summary: summarize(events, SAMPLES, {
      gateSkipped,
      ledgerKeys: [...new Set(entries.map((entry) => entry.key))],
      claims: claimed.length,
      claimedSegmentIds: claimed,
      source: 'fixture-plan-11',
      agendaSegments: FIXTURE_SEGMENTS.length,
      quotaTouches: events.filter((event) => event.usedTodayBefore >= DAILY_CAP - 1).length,
      note: 'quota / cooldown 由本脚本外挂，pickCandidate 本身不管这两道',
    }),
    events,
  }
}

/* ---------------- 落盘 ---------------- */

function parseArgs(argv) {
  const args = { out: resolve(ROOT, 'scripts/baselines/agenda-baseline.json') }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out' && argv[index + 1]) {
      args.out = resolve(process.cwd(), argv[index + 1])
      index += 1
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const payload = {
  meta: {
    generatedAt: new Date().toISOString(),
    fixture: {
      base: isoAt(BASE),
      baseEpoch: BASE,
      stepMs: STEP_MS,
      samples: SAMPLES,
      dailyCap: DAILY_CAP,
      minGapMs: MIN_GAP_MS,
      jitter: JITTER,
      warmth: WARMTH,
      seed: '0x5eed2026',
      memories: FIXTURE_MEMORIES,
      segments: FIXTURE_SEGMENTS,
    },
    semantics: {
      scheduleDayKey: 'personaDayKey (UTC+8)',
      scheduleAgendaKey: 'personaDayKey (UTC+8)',
      planDateKey: 'local dateKey (daily-plan.mjs) — 不在本脚本',
      runtimeDateKey: 'local dateKeyOf (agenda-runtime.mjs) — 不在本脚本',
      candidateMinute: 'minuteOfDay (local)',
    },
    excluded: ['外壳时段闸 (23:00–08:00)', '模型生成 plan', 'AgendaClaims 实例', 'bubble-tone 的真实 warmth 来源'],
  },
  chains: {
    schedule: runSchedule(),
    plan: runPlan(),
  },
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

const schedule = payload.chains.schedule.summary
const plan = payload.chains.plan.summary
console.log(`write  ${args.out}`)
console.log(
  `schedule  开口 ${schedule.opened}/${schedule.samples}  四类 ${JSON.stringify(schedule.byKind)}  安静时段 ${schedule.quietHourOpened}`
)
console.log(
  `plan      开口 ${plan.opened}/${plan.samples}  四类 ${JSON.stringify(plan.byKind)}  安静时段 ${plan.quietHourOpened}  去重 ${plan.claims}`
)
console.log(`schedule  间隔桶 ${JSON.stringify(schedule.gapBuckets)}`)
console.log(`plan      间隔桶 ${JSON.stringify(plan.gapBuckets)}`)
