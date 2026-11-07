#!/usr/bin/env node
/**
 * 游戏日常的无值守运行器。
 *
 * 由 Windows 计划任务调起，不依赖 Electron 窗口：
 *   node game-daily-runner.mjs --game genshin --state-dir <数据目录> [--run-id <id>]
 *
 * 判定只看自己写出的 report.json，不看退出码。真实执行时，第三方引擎跑完
 * 并不等于日常真的做完——这一点不猜，统一先记 `partial`，等后续能读到
 * 引擎报告或截图证据再升级成 `success`。
 */

import fs from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { decideLaunch, gameProcessName, normalizeDailyState } from '@pet/core/browser'

const REPORT_DIR = 'runs'
const LOG_FILE = 'stdout.log'

function parseArgs(argv) {
  const args = { game: '', stateDir: '', runId: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--game' && typeof value === 'string') {
      args.game = value
      index += 1
    } else if (key === '--state-dir' && typeof value === 'string') {
      args.stateDir = value
      index += 1
    } else if (key === '--run-id' && typeof value === 'string') {
      args.runId = value
      index += 1
    }
  }
  return args
}

function makeRunId(now = Date.now()) {
  return new Date(now).toISOString().replace(/[:.]/g, '-')
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temp, filePath)
}

function reportPath(stateDir, game, runId) {
  return path.join(stateDir, REPORT_DIR, game, runId, 'report.json')
}

function step(name, ok, detail, at = Date.now()) {
  return detail === undefined ? { name, ok, at } : { name, ok, detail, at }
}

/**
 * 启动引擎并等它退出。
 *
 * 返回值只有「进程怎么结束的」，不判断任务是否完成。
 * 超时由外部定时器触发 `stop`，这里只负责把日志接到文件。
 */
function runEngine({ program, args, cwd, logFile, onSpawn }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(program, args, {
        cwd,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({ code: null, error: error?.message ?? String(error) })
      return
    }

    const log = createWriteStream(logFile, { flags: 'a' })
    log.write(`\n[runner] ${new Date().toISOString()} spawn ${program} ${args.join(' ')}\n`)
    child.stdout?.pipe(log, { end: false })
    child.stderr?.pipe(log, { end: false })

    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      log.end()
      resolve(result)
    }

    child.on('error', (error) => finish({ code: null, error: error?.message ?? String(error) }))
    child.on('exit', (code, signal) => finish({ code, signal }))

    if (typeof onSpawn === 'function') onSpawn(child)
  })
}

/** Windows 下结束整棵进程树；只 kill 父进程经常留下游戏本体。 */
function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch {
    // taskkill 不可用时只能让计划任务的上限来收尾。
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 用 tasklist 确认进程在不在。查不到就返回 false，不猜。 */
function isProcessRunning(exeName) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/NH'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch {
      resolve(false)
      return
    }

    let output = ''
    child.stdout?.on('data', (chunk) => {
      output += String(chunk)
    })
    child.on('error', () => resolve(false))
    child.on('exit', () => resolve(output.toLowerCase().includes(exeName.toLowerCase())))
  })
}

/** 等游戏进程出现。超时返回 false，让调用方如实记账。 */
async function waitForProcess(exeName, timeoutMs, intervalMs = 3_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isProcessRunning(exeName)) return true
    await sleep(intervalMs)
  }
  return false
}

/**
 * 拉起游戏本体。
 *
 * detached + unref：日常跑完，游戏该留着还是关掉由用户决定，
 * runner 不能因为自己退出就顺手结束它。
 */
function launchDetached(exe) {
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  child.unref()
  return child.pid
}

export async function runOnce(options) {
  const { game, stateDir, runId = makeRunId() } = options
  const startedAt = Date.now()
  const dir = path.join(stateDir, REPORT_DIR, game, runId)
  await fs.mkdir(dir, { recursive: true })
  const logFile = path.join(dir, LOG_FILE)

  const raw = await fs.readFile(path.join(stateDir, 'state.json'), 'utf8').catch(() => null)
  const state = normalizeDailyState(raw === null ? null : JSON.parse(raw))
  const config = state.games[game]

  const finish = async (report) => {
    const full = {
      runId,
      game,
      mode: config?.mode ?? 'dry',
      startedAt,
      endedAt: Date.now(),
      steps: [],
      evidence: [logFile],
      ...report
    }
    await writeJsonAtomic(reportPath(stateDir, game, runId), full)
    await writeJsonAtomic(path.join(dir, 'meta.json'), {
      runId,
      game,
      mode: full.mode,
      status: full.status,
      startedAt: full.startedAt,
      endedAt: full.endedAt,
      logFile
    })
    return full
  }

  if (config === undefined) {
    return finish({
      status: 'failed',
      steps: [step('读取配置', false, `state.json 里没有 ${game}`)],
      conclusion: '没有找到这个游戏的排班，按失败记账'
    })
  }

  if (config.mode === 'dry') {
    return finish({
      status: 'success',
      steps: [
        step('读取配置', true, `${game} ${config.time}，上限 ${config.timeoutMinutes} 分钟`),
        step('检查执行器', true, config.gamePath ?? '未配置引擎路径（演练不需要）', Date.now()),
        step('演练', true, '只验证配置与路径，没有启动游戏或第三方工具'),
        step('留档', true, dir)
      ],
      conclusion: '演练完成：配置可读，未对游戏做任何操作'
    })
  }

  if (typeof config.gamePath !== 'string' || config.gamePath === '') {
    return finish({
      status: 'failed',
      steps: [step('检查执行器', false, '真实执行需要先在设置里指定引擎可执行文件')],
      conclusion: '缺少引擎路径，没有启动任何进程'
    })
  }

  const timeoutMs = config.timeoutMinutes * 60_000
  // 看门狗提前 5 分钟收尾，给写盘和进程退出留时间。
  const closeAfter = Math.max(1_000, timeoutMs - 5 * 60_000)

  // 引擎跑之前先把游戏拉起来。演练和未授权的情况都留一条跳过记录，
  // 这样报告能解释「为什么没有游戏进程」。
  const launch = decideLaunch(
    {
      game,
      mode: config.mode,
      launchGame: config.launchGame === true,
      installPath: config.installPath
    },
    existsSync
  )

  if (launch.action === 'blocked') {
    return finish({
      status: 'failed',
      steps: [
        step('检查游戏本体', false, `没有找到可执行文件，试过 ${launch.tried.length} 条候选路径`),
        step('候选路径', false, launch.tried.slice(0, 6).join('；'))
      ],
      conclusion: '找不到游戏本体，没有启动引擎'
    })
  }

  const launchSteps = []
  if (launch.action === 'skip') {
    launchSteps.push(
      step('启动游戏', true, launch.reason === 'dry' ? '演练不启动' : '排班未允许启动游戏')
    )
  } else {
    let pid = null
    let launchError = null
    try {
      pid = launchDetached(launch.exe)
    } catch (error) {
      launchError = error?.message ?? String(error)
    }

    if (launchError !== null) {
      return finish({
        status: 'failed',
        steps: [step('启动游戏', false, launchError)],
        conclusion: '游戏没有启动成功，跳过引擎'
      })
    }

    launchSteps.push(step('启动游戏', true, `${launch.exe}（pid ${String(pid)}）`))

    const exeName = gameProcessName(game)
    const appeared = await waitForProcess(exeName, 120_000)
    if (!appeared) {
      return finish({
        status: 'failed',
        steps: [...launchSteps, step('等待游戏进程', false, `${exeName} 120 秒内没有出现`)],
        conclusion: '游戏进程没有起来，没有启动引擎'
      })
    }

    launchSteps.push(
      step(
        '等待游戏就绪',
        true,
        `已出现 ${exeName}，再等 ${Math.round(launch.graceMs / 1000)} 秒加载`
      )
    )
    await sleep(launch.graceMs)
  }

  let child = null
  let timedOut = false
  const watchdog = setTimeout(() => {
    timedOut = true
    if (child !== null) killTree(child.pid)
  }, closeAfter)

  const result = await runEngine({
    program: config.gamePath,
    args: [],
    cwd: path.dirname(config.gamePath),
    logFile,
    onSpawn: (spawned) => {
      child = spawned
    }
  })

  clearTimeout(watchdog)

  if (timedOut) {
    return finish({
      status: 'timeout',
      steps: [
        ...launchSteps,
        step('启动引擎', true, config.gamePath),
        step('看门狗收尾', false, '到点仍未结束，已结束进程树')
      ],
      conclusion: `超过 ${config.timeoutMinutes} 分钟仍未结束，按超时记账`
    })
  }

  if (result.error !== undefined) {
    return finish({
      status: 'failed',
      steps: [...launchSteps, step('启动引擎', false, result.error)],
      conclusion: '引擎没有启动成功'
    })
  }

  const ok = result.code === 0
  return finish({
    status: ok ? 'partial' : 'failed',
    steps: [
      ...launchSteps,
      step('启动引擎', true, config.gamePath),
      step('引擎退出', ok, `退出码 ${String(result.code)}`)
    ],
    conclusion: ok
      ? '引擎已退出，但还没有能证明日常完成的证据，先记部分完成'
      : `引擎退出码 ${String(result.code)}，按失败记账`
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.game === '' || args.stateDir === '') {
    console.error('用法：node game-daily-runner.mjs --game <id> --state-dir <目录> [--run-id <id>]')
    process.exitCode = 2
    return
  }

  try {
    const report = await runOnce({
      game: args.game,
      stateDir: args.stateDir,
      runId: args.runId === '' ? makeRunId() : args.runId
    })
    console.log(`[runner] ${report.game} ${report.status} ${report.runId}`)
  } catch (error) {
    console.error(`[runner] 未捕获错误：${error?.stack ?? String(error)}`)
    process.exitCode = 1
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith('game-daily-runner.mjs')

if (invokedDirectly) {
  await main()
}
