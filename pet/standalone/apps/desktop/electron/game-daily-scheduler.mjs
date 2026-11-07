/**
 * 计划任务宿主：把 state.json 里的排班变成 Windows 计划任务。
 *
 * 职责边界：
 * - 生成脚本、写盘、调用 PowerShell；
 * - 不猜提权是否成功——注册完一律用 `query` 回读任务是否真的存在；
 * - 失败时把脚本路径一起返回，用户可以在终端里手工再看一遍。
 *
 * 提权只发生一次（注册时），之后每天由任务计划程序自己拉起 runner。
 */

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import {
  DEFAULT_TASK_PREFIX,
  buildQueryScript,
  buildRegisterScript,
  buildRunnerArguments,
  buildUnregisterScript,
  enabledGames,
  toTaskSpec
} from '@pet/core/browser'

/** 找系统 Node。Electron 自带的 electron.exe 需要 RUN_AS_NODE，计划任务传不了环境变量。 */
export function resolveNodeProgram(candidates = [], exists = () => false) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    try {
      if (exists(candidate)) return candidate
    } catch {
      // 单个候选探测失败就继续看下一个。
    }
  }
  return null
}

/**
 * 候选按可信度排：环境变量 → 标准安装位置 → PATH。
 *
 * PATH 这一段不能省：便携 Node（比如 D:\tools\node）经常不在标准位置，
 * 只查 Program Files 会让「已经装好 Node」的机器被判成没装。
 */
export function collectNodeCandidates(env = process.env) {
  const fromPath = String(env.PATH ?? '')
    .split(path.delimiter)
    .filter((dir) => dir.trim() !== '')
    .map((dir) => path.join(dir.trim(), 'node.exe'))

  return [
    env.CYRENE_NODE,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    ...fromPath
  ]
}

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: options.timeout ?? 120_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          code: error?.code ?? 0,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '')
        })
      }
    )
  })
}

function looksLikePermissionError(text) {
  return /access is denied|拒绝访问|0x80070005|requires elevation|需要提升/i.test(text)
}

export function createDailyScheduler(options = {}) {
  const stateDir = options.stateDir
  const runnerPath = options.runnerPath
  const projectRoot = options.projectRoot
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw new TypeError('createDailyScheduler 需要 stateDir')
  }
  if (typeof runnerPath !== 'string' || runnerPath === '') {
    throw new TypeError('createDailyScheduler 需要 runnerPath')
  }

  const runFile = typeof options.run === 'function' ? options.run : run
  const nodeProgram =
    typeof options.nodeProgram === 'string' && options.nodeProgram !== ''
      ? options.nodeProgram
      : resolveNodeProgram(collectNodeCandidates(), existsSync)

  const automationDir = path.join(stateDir, 'automation')

  function taskName(game) {
    return `${DEFAULT_TASK_PREFIX}${game}`
  }

  /** 只生成计划，不落盘。UI 可以先展示「会注册哪几个任务」。 */
  function plan(state) {
    if (nodeProgram === null) {
      return {
        ok: false,
        code: 'node-not-found',
        message: '没有找到系统 Node（node.exe）。计划任务需要一个能直接启动的解释器。'
      }
    }

    const items = enabledGames(state).map((config) => {
      const spec = toTaskSpec(config, { prefix: DEFAULT_TASK_PREFIX })
      const action = {
        program: nodeProgram,
        arguments: `"${runnerPath}" ${buildRunnerArguments(config.game, { stateDir })}`,
        workingDirectory: projectRoot ?? path.dirname(runnerPath)
      }
      return {
        game: config.game,
        taskName: spec.name,
        spec,
        action,
        scriptPath: path.join(automationDir, `register-${config.game}.ps1`),
        script: buildRegisterScript({ spec, action })
      }
    })

    return { ok: true, items, nodeProgram }
  }

  /** 把注册脚本写进数据目录。UTF-8 BOM 是给 Windows PowerShell 5 认中文用的。 */
  async function writeScripts(items) {
    await fs.mkdir(automationDir, { recursive: true })
    for (const item of items) {
      await fs.writeFile(item.scriptPath, `\uFEFF${item.script}`, 'utf8')
    }
    return items.map((item) => item.scriptPath)
  }

  /** 真正执行注册脚本。默认不提权；提权交给 `applyElevated`。 */
  async function apply(state) {
    const built = plan(state)
    if (!built.ok) return built

    await writeScripts(built.items)

    const failures = []
    for (const item of built.items) {
      const result = await runFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', item.scriptPath],
        { timeout: 60_000 }
      )
      if (!result.ok) {
        failures.push({
          game: item.game,
          scriptPath: item.scriptPath,
          needsElevation: looksLikePermissionError(`${result.stderr}\n${result.stdout}`),
          stderr: result.stderr.trim(),
          stdout: result.stdout.trim()
        })
      }
    }

    // 不以退出码为准，回读任务列表。
    const queried = await query(state)
    const registered = queried.ok ? queried.tasks.map((task) => task.name) : []
    const expected = built.items.map((item) => item.taskName)
    const allPresent = expected.every((name) => registered.includes(name))

    return {
      ok: allPresent,
      nodeProgram: built.nodeProgram,
      expected,
      registered,
      failures,
      scripts: built.items.map((item) => item.scriptPath),
      needsElevation: failures.some((failure) => failure.needsElevation)
    }
  }

  /** 用一次 UAC 重放某个注册脚本。结果仍然靠 query 回读判断。 */
  async function applyElevated(scriptPath) {
    const quoted = `'${String(scriptPath).replace(/'/g, "''")}'`
    const command =
      `Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${quoted})`
    const result = await runFile('powershell.exe', ['-NoProfile', '-Command', command], {
      timeout: 120_000
    })
    return {
      ok: result.ok,
      // UAC 被取消时 PowerShell 会报「操作已被用户取消」。
      cancelled: /canceled|cancelled|取消/i.test(`${result.stderr}`),
      stderr: result.stderr.trim()
    }
  }

  async function disable(games) {
    const names = (Array.isArray(games) ? games : []).map((game) => taskName(game))
    if (names.length === 0) return { ok: true, removed: [] }

    await fs.mkdir(automationDir, { recursive: true })
    const scriptPath = path.join(automationDir, 'unregister.ps1')
    await fs.writeFile(scriptPath, `\uFEFF${buildUnregisterScript(names)}`, 'utf8')

    const result = await runFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 60_000 }
    )

    const queried = await query(null, names)
    return {
      ok: result.ok && queried.ok,
      removed: queried.ok ? queried.tasks.map((task) => task.name) : [],
      needsElevation: !result.ok && looksLikePermissionError(`${result.stderr}`)
    }
  }

  /**
   * 回读计划任务。
   *
   * `state` 为 null 时用传入的 names（删除后核对用）；否则读 state 里所有任务的名称，
   * 包括已关闭的游戏——关闭之后也要能确认任务真的被移除了。
   */
  async function query(state, names = null) {
    const targetNames =
      Array.isArray(names) && names.length > 0
        ? names
        : ['genshin', 'hi3', 'starrail', 'zzz'].map((game) => taskName(game))

    await fs.mkdir(automationDir, { recursive: true })
    const scriptPath = path.join(automationDir, 'query.ps1')
    await fs.writeFile(scriptPath, `\uFEFF${buildQueryScript(targetNames)}`, 'utf8')

    const result = await runFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 30_000 }
    )
    if (!result.ok) {
      return { ok: false, tasks: [], stderr: result.stderr.trim() }
    }

    try {
      const parsed = JSON.parse(result.stdout.trim() === '' ? '[]' : result.stdout.trim())
      return { ok: true, tasks: Array.isArray(parsed) ? parsed : [parsed] }
    } catch {
      return { ok: false, tasks: [], stderr: '计划任务查询结果不是 JSON' }
    }
  }

  return {
    taskName,
    plan,
    writeScripts,
    apply,
    applyElevated,
    disable,
    query,
    nodeProgram
  }
}
