import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'dsh-cyrene-balance'
export const inject = ['tools']

export const Config = z.object({
  /** DeepSeek API Key；留空则读环境变量 DEEPSEEK_API_KEY */
  apiKey: z.string().default(''),
  /** 余额提醒阈值（元），0 表示不提醒 */
  balanceThreshold: z.number().default(20),
  /** 今日额度上限（元），0 表示不启用 */
  dailyLimit: z.number().default(0),
  /** 默认视图：all / today / balance */
  view: z.string().default('all'),
  /** 自定义数据目录 */
  dataDir: z.string().default(''),
})

const API_URL = 'https://api.deepseek.com/user/balance'
const VIEWS = ['all', 'today', 'balance']

function resolveDir(config) {
  if (config && config.dataDir) return config.dataDir
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'plugin-data', 'dsh-cyrene-balance')
}

function resolveApiKey(config) {
  if (config && config.apiKey) return config.apiKey.trim()
  return String(process.env.DEEPSEEK_API_KEY || '').trim()
}

function normalizeView(value) {
  return VIEWS.includes(value) ? value : 'all'
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function round(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 1000000) / 1000000 : 0
}

function asText(_args, value) {
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return [{ type: 'text', text: value.text }]
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text }]
}

function beijingNow(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600 * 1000)
}

function todayKey(now = new Date()) {
  const bj = beijingNow(now)
  const y = bj.getUTCFullYear()
  const m = String(bj.getUTCMonth() + 1).padStart(2, '0')
  const d = String(bj.getUTCDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

function peakState(now = new Date()) {
  const bj = beijingNow(now)
  const minutes = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  const offPeak = minutes >= 30 && minutes < 8 * 60 + 30
  return offPeak
    ? { peak: false, label: '谷价时段（半价）' }
    : { peak: true, label: '峰价时段（全价）' }
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    if (error instanceof SyntaxError) return fallback
    throw error
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8')
}

async function loadSettings(dir, config) {
  const saved = (await readJson(path.join(dir, 'settings.json'), null)) || {}
  const threshold = Number(saved.threshold)
  const dailyLimit = Number(saved.dailyLimit)
  return {
    threshold: Number.isFinite(threshold)
      ? threshold
      : Number(config.balanceThreshold) || 0,
    dailyLimit: Number.isFinite(dailyLimit)
      ? dailyLimit
      : Number(config.dailyLimit) || 0,
    view: normalizeView(saved.view || config.view),
  }
}

async function saveSettings(dir, settings) {
  await writeJson(path.join(dir, 'settings.json'), settings)
}

async function updateLedger(dir, total) {
  const today = todayKey()
  const ledger =
    (await readJson(path.join(dir, 'ledger.json'), null)) || {
      date: today,
      baseline: null,
      spent: 0,
      recharge: 0,
      lastTotal: null,
      history: {},
    }

  if (ledger.date !== today) {
    if (ledger.date && Number(ledger.spent) > 0) {
      const history = ledger.history && typeof ledger.history === 'object' ? ledger.history : {}
      history[ledger.date] = round(Number(history[ledger.date] || 0) + Number(ledger.spent))
      const keys = Object.keys(history).sort()
      while (keys.length > 30) delete history[keys.shift()]
      ledger.history = history
    }
    ledger.date = today
    ledger.baseline = null
    ledger.spent = 0
    ledger.recharge = 0
    ledger.lastTotal = null
  }

  if (ledger.baseline === null || ledger.baseline === undefined) ledger.baseline = total

  const last = Number(ledger.lastTotal)
  if (Number.isFinite(last) && ledger.lastTotal !== null) {
    const diff = total - last
    if (diff < 0) {
      ledger.spent = round(Number(ledger.spent) + -diff)
    } else if (diff > 0) {
      ledger.recharge = round(Number(ledger.recharge) + diff)
      ledger.baseline = round(Number(ledger.baseline) + diff)
    }
  }

  ledger.lastTotal = total
  ledger.at = new Date().toISOString()
  ledger.history = ledger.history && typeof ledger.history === 'object' ? ledger.history : {}
  await writeJson(path.join(dir, 'ledger.json'), ledger)
  return ledger
}

async function fetchBalance(apiKey, signal) {
  const response = await fetch(API_URL, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      Accept: 'application/json',
      'User-Agent': 'dsh-cyrene-balance',
    },
    signal,
  })
  const raw = await response.text()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    data = raw
  }
  if (!response.ok) {
    throw new Error('余额接口返回 HTTP ' + response.status + '：' + String(raw).slice(0, 200))
  }
  const info = data && Array.isArray(data.balance_infos) ? data.balance_infos[0] : null
  if (!info) throw new Error('余额接口响应里没有 balance_infos')
  return {
    currency: info.currency || 'CNY',
    total: Number(info.total_balance) || 0,
    granted: Number(info.granted_balance) || 0,
    toppedUp: Number(info.topped_up_balance) || 0,
  }
}

function formatResult(result) {
  const lines = []
  if (result.view === 'balance') {
    lines.push('DeepSeek 余额：' + result.currency + ' ' + money(result.total))
    if (result.low) lines.push('⚠ 已低于提醒阈值 ' + money(result.threshold) + ' 元')
    return lines.join('\n')
  }

  const today = [
    '今日已用 ' +
      money(result.spent) +
      ' 元' +
      (result.dailyLimit > 0
        ? ' / 额度 ' + money(result.dailyLimit) + ' 元，剩余 ' + money(result.remain) + ' 元'
        : '（今日额度未设置）'),
  ]
  if (result.dailyLimit > 0) today.push('额度已用 ' + Math.round(result.ratio * 100) + '%')
  if (result.recharge > 0) today.push('今日充值 ' + money(result.recharge) + ' 元')
  if (result.overLimit) today.push('⚠ 今日额度已超限，收着点用呀')
  else if (result.warnLimit) today.push('⚠ 今日额度已用掉八成')

  if (result.view === 'today') return today.join('\n')

  lines.push('DeepSeek 余额：' + result.currency + ' ' + money(result.total))
  if (result.granted > 0) lines.push('其中赠金 ' + money(result.granted) + ' 元')
  lines.push(...today)
  lines.push('当前' + result.peak.label)
  lines.push(
    result.low
      ? '⚠ 余额已低于提醒阈值 ' + money(result.threshold) + ' 元'
      : '余额高于提醒阈值 ' + money(result.threshold) + ' 元'
  )
  lines.push('数据时间 ' + result.at)
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  const dir = resolveDir(config)

  ctx.tools.register(
    defineTool({
      name: 'deepseek_balance',
      description:
        '查询 DeepSeek API 账户余额、今日消费、今日充值、今日额度与峰谷时段。view 可选：all 全部（默认）、today 只看今日已用和额度、balance 只看余额。用户问「还有多少钱」用 balance，「今天用了多少 / 额度还剩多少」用 today。',
      parameters: {
        view: {
          type: 'string',
          description: '显示范围：all / today / balance，省略则用配置里的默认视图',
        },
      },
      output: { schema: { type: 'json' }, render: asText },
      async execute(args, exec) {
        const settings = await loadSettings(dir, config)
        const view = normalizeView((args && args.view) || settings.view)
        const apiKey = resolveApiKey(config)
        if (!apiKey) {
          return {
            ok: false,
            error: '没有 DeepSeek API Key：请在插件 config.apiKey 或环境变量 DEEPSEEK_API_KEY 里配置',
          }
        }
        try {
          const balance = await fetchBalance(apiKey, exec && exec.signal)
          const ledger = await updateLedger(dir, balance.total)
          const limit = Number(settings.dailyLimit) || 0
          const spent = Number(ledger.spent) || 0
          const remain = limit > 0 ? Math.max(0, limit - spent) : 0
          const ratio = limit > 0 ? spent / limit : 0
          const result = {
            ok: true,
            view,
            currency: balance.currency,
            total: round(balance.total),
            granted: round(balance.granted),
            toppedUp: round(balance.toppedUp),
            spent: round(spent),
            recharge: round(ledger.recharge),
            dailyLimit: round(limit),
            remain: round(remain),
            ratio: round(ratio),
            overLimit: limit > 0 && spent >= limit,
            warnLimit: limit > 0 && spent >= limit * 0.8 && spent < limit,
            threshold: round(settings.threshold),
            low: balance.total < settings.threshold,
            peak: peakState(),
            at: new Date().toISOString(),
          }
          result.text = formatResult(result)
          await writeJson(path.join(dir, 'last.json'), result)
          return result
        } catch (error) {
          return { ok: false, error: String(error && error.message ? error.message : error) }
        }
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'balance_set_limit',
      description:
        '调节今日额度上限与余额提醒阈值。用户说「今天额度改成 40 元」「余额低于 10 元提醒我」「关掉今日额度」时使用。limit 为 0 表示关闭今日额度提醒。',
      parameters: {
        limit: {
          type: 'number',
          description: '今日额度上限（元），0 表示关闭；省略则不修改',
        },
        threshold: {
          type: 'number',
          description: '余额提醒阈值（元），0 表示关闭；省略则不修改',
        },
      },
      output: { schema: { type: 'json' }, render: asText },
      async execute(args) {
        const hasLimit = args && args.limit !== undefined && args.limit !== null
        const hasThreshold = args && args.threshold !== undefined && args.threshold !== null
        if (!hasLimit && !hasThreshold) {
          return { ok: false, error: '没有要改的值：至少提供 limit 或 threshold' }
        }
        const settings = await loadSettings(dir, config)
        if (hasLimit) {
          const value = Number(args.limit)
          if (!Number.isFinite(value) || value < 0 || value > 100000) {
            return { ok: false, error: '今日额度需要是 0 到 100000 之间的数字' }
          }
          settings.dailyLimit = round(value)
        }
        if (hasThreshold) {
          const value = Number(args.threshold)
          if (!Number.isFinite(value) || value < 0 || value > 100000) {
            return { ok: false, error: '提醒阈值需要是 0 到 100000 之间的数字' }
          }
          settings.threshold = round(value)
        }
        await saveSettings(dir, settings)
        const last = (await readJson(path.join(dir, 'last.json'), null)) || null
        const lines = []
        if (hasLimit) {
          lines.push(
            settings.dailyLimit > 0
              ? '今日额度改成 ' + money(settings.dailyLimit) + ' 元'
              : '今日额度提醒已关闭'
          )
        }
        if (hasThreshold) {
          lines.push(
            settings.threshold > 0
              ? '余额低于 ' + money(settings.threshold) + ' 元提醒你'
              : '余额提醒已关闭'
          )
        }
        if (last && settings.dailyLimit > 0) {
          const spent = Number(last.spent) || 0
          lines.push(
            '今天已经用了 ' +
              money(spent) +
              ' 元（' +
              Math.round((spent / settings.dailyLimit) * 100) +
              '%）' +
              (spent >= settings.dailyLimit ? '，已经超限' : '')
          )
        }
        return {
          ok: true,
          dailyLimit: settings.dailyLimit,
          threshold: settings.threshold,
          view: settings.view,
          text: lines.join('\n'),
        }
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'balance_set_view',
      description:
        '设置默认查询视图：all 全部、today 只看今日额度、balance 只看余额。用户说「以后只报今日额度」「只看余额就行」时使用。',
      parameters: {
        view: {
          type: 'string',
          required: true,
          description: '视图：all / today / balance',
        },
      },
      output: { schema: { type: 'json' }, render: asText },
      async execute(args) {
        const view = args && args.view
        if (!VIEWS.includes(view)) {
          return { ok: false, error: 'view 只能是 all / today / balance' }
        }
        const settings = await loadSettings(dir, config)
        settings.view = view
        await saveSettings(dir, settings)
        const label = { all: '全部信息', today: '只看今日额度', balance: '只看余额' }[view]
        return { ok: true, view, text: '好，以后默认' + label + '。' }
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'balance_status',
      description:
        '查看余额插件的当前设置与最近一次查询结果，不发起新的网络请求。用户问「额度设成多少了 / 上次查询是什么时候」时使用。',
      parameters: {},
      output: { schema: { type: 'json' }, render: asText },
      async execute() {
        const settings = await loadSettings(dir, config)
        const last = (await readJson(path.join(dir, 'last.json'), null)) || null
        const lines = [
          '余额提醒阈值：' + (settings.threshold > 0 ? money(settings.threshold) + ' 元' : '未启用'),
          '今日额度上限：' + (settings.dailyLimit > 0 ? money(settings.dailyLimit) + ' 元' : '未启用'),
          '默认视图：' +
            ({ all: '全部信息', today: '只看今日额度', balance: '只看余额' }[settings.view] || settings.view),
          'API Key：' + (resolveApiKey(config) ? '已配置' : '未配置'),
        ]
        if (last) {
          lines.push(
            '上次查询：余额 ' +
              money(last.total) +
              ' ' +
              (last.currency || 'CNY') +
              '，今日已用 ' +
              money(last.spent) +
              ' 元（' +
              last.at +
              '）'
          )
          if (last.dailyLimit > 0) {
            lines.push(
              '额度使用：' +
                Math.round((Number(last.spent) / Number(last.dailyLimit)) * 100) +
                '%' +
                (last.overLimit ? '，已超限' : last.warnLimit ? '，接近上限' : '')
            )
          }
        } else {
          lines.push('上次查询：还没有记录')
        }
        return {
          ok: true,
          settings,
          last,
          hasApiKey: Boolean(resolveApiKey(config)),
          text: lines.join('\n'),
        }
      },
    })
  )

  ctx.tools.register(
    defineTool({
      name: 'balance_history',
      description:
        '查看最近 7 天每天的 DeepSeek 消费与今日已用。用户问「这周花了多少 / 前几天用了多少」时使用。',
      parameters: {},
      output: { schema: { type: 'json' }, render: asText },
      async execute() {
        const ledger =
          (await readJson(path.join(dir, 'ledger.json'), null)) || {
            date: todayKey(),
            spent: 0,
            history: {},
          }
        const history = ledger.history && typeof ledger.history === 'object' ? ledger.history : {}
        const entries = Object.keys(history)
          .sort()
          .slice(-7)
        const lines = []
        let total = 0
        for (const date of entries) {
          const value = Number(history[date]) || 0
          total += value
          lines.push(date.slice(5) + '  ' + money(value) + ' 元')
        }
        if (!lines.length) lines.push('还没有历史记录，明天开始会有。')
        const todaySpent = Number(ledger.spent) || 0
        if (todaySpent > 0) {
          lines.push('今天已用 ' + money(todaySpent) + ' 元')
          total += todaySpent
        }
        if (total > 0) lines.push('合计 ' + money(total) + ' 元')
        return {
          ok: true,
          history,
          today: todayKey(),
          todaySpent: round(todaySpent),
          text: lines.join('\n'),
        }
      },
    })
  )
}
