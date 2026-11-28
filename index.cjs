'use strict'

/**
 * dsh-cyrene-pet — Cyrene 宿主入口（CJS 适配层）。
 *
 * 宿主认的形态是 { apiVersion, id, register(ctx), unregister() }；
 * 插件主体 lib/index.js 是 Cordis 形态（export name / inject / apply）。
 * 这一层只做桥接，不复制任何业务逻辑。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ID = 'dsh-cyrene-pet'
/*
 * A2-006：插件世代取自装载身份（本目录 package.json 的 version），
 * 不再在这份入口里另存一份硬编副本 —— 改之前这里是 '2.0.0'，而 package.json 已经是 2.0.1，
 * 于是插件对宿主自称 2.0.1、marker 每行尾却写 v2.0.0，按 marker 归因世代那条链会记错档。
 * 读不到包信息时回落 'unknown'：marker 缺世代比世代旧一档更难查。
 */
const { generationOf, markerLine } = require('./lib/plugin-generation.mjs')

function readOwnPackage() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

const GENERATION = generationOf(readOwnPackage())

let modulePromise = null
let activeCtx = null
let applied = false

function markerPath() {
  // APPDATA 缺失时不能退化成相对路径，否则 marker 会写进当前工作目录。
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(base, 'Cyrene', `${ID}.marker`)
}

function record(line) {
  try {
    const file = markerPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, markerLine({ at: new Date(), line, generation: GENERATION }), 'utf8')
  } catch (error) {
    // 痕迹写不了不影响加载
  }
}

function log(ctx, message) {
  record(message)
  try {
    if (ctx && typeof ctx.log === 'function') ctx.log(`[${ID}] ${message}`)
    else console.log(`[${ID}] ${message}`)
  } catch (error) {
    // 日志通道异常不判成加载失败
  }
}

function loadModule() {
  if (!modulePromise) {
    const entry = path.join(__dirname, 'lib', 'index.js')
    const cacheBust = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    modulePromise = import(`${pathToFileURL(entry).href}?cyreneReload=${cacheBust}`).catch((error) => {
      modulePromise = null
      record(`load-failed ${error && error.message}`)
      throw error
    })
  }
  return modulePromise
}

/**
 * S0 宿主身份校验（IN-001）。
 *
 * 真的 DSH 运行时可能以两种形态出现：
 *   - 独立包：name 以 @deepseek-ai/dsh 开头；
 *   - 打包在 Cyrene 里：根 package.json 的 name 是 cyrene-agent。
 *
 * 两种都必须能从运行时 resources/app.asar 里读到自己的 package.json。
 * 伪造 webServer / systemPrompt 的第三方 Agent 拿不出这份文件，直接拒绝加载。
 * 校验不通过宁可整插件不生效，也不把人格、记忆、会话权限交给来历不明的宿主。
 */
function verifyHostIdentity() {
  const candidates = []
  const push = (file) => {
    if (typeof file === 'string' && file !== '') candidates.push(file)
  }
  // Electron main：resourcesPath 指向安装目录，旁边就是 app.asar。
  push(typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'app.asar', 'package.json')
    : '')
  push(typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'package.json')
    : '')
  // 兼容 DSH 作为独立子目录打包的旧形态。
  push(typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'app.asar', 'dsh', 'package.json')
    : '')
  push(typeof process.resourcesPath === 'string'
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dsh', 'package.json')
    : '')
  // 桌面宿主的 Node 子进程：argv[2] 是 dsh 运行时目录。
  push(typeof process.argv?.[2] === 'string'
    ? path.join(process.argv[2], 'package.json')
    : '')
  // execPath 兜底：app.asar 在可执行文件旁的 resources 里。
  if (typeof process.execPath === 'string' && process.execPath !== '') {
    push(path.join(path.dirname(process.execPath), 'resources', 'app.asar', 'package.json'))
  }

  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      const name = typeof parsed?.name === 'string' ? parsed.name : ''
      if (name === 'cyrene-agent' || name.startsWith('@deepseek-ai/dsh')) {
        record(`host-verified ${name}@${typeof parsed?.version === 'string' ? parsed.version : '?'}`)
        return
      }
    } catch {
      // 这个候选不存在或读不了，试下一个。
    }
  }
  throw new Error('宿主身份校验失败：当前进程不是 DeepSeek Harness，拒绝加载')
}

const plugin = {
  apiVersion: 1,
  id: ID,

  /*
   * 宿主按这一层声明的 inject 决定什么时候把服务挂进 ctx。
   * lib/index.js 里的 inject 只影响 Cordis 形态，宿主读的是这里；
   * 漏掉它时 0.2.2 会在 ctx.webServer 还没就绪时就调用 register，
   * apply 立刻抛错，随后被宿主 unregister——表现就是「装上但没反应」。
   */
  inject: ['webServer', 'systemPrompt'],

  async register(ctx) {
    activeCtx = ctx
    record('register-enter')
    try {
      /*
       * S0 红线：先验宿主身份，再谈加载。
       * 任何伪造 webServer + systemPrompt 的 Agent 都过不了这一关——
       * 真的 DeepSeek Harness 一定带着自己的运行时 package.json。
       */
      verifyHostIdentity()

      /*
       * Cyrene 宿主的 ctx 没有 Cordis 的 effect/on，也没有 webServer；
       * 本体 apply 顶部会用 host-compat 垫片降级，不能再按 ctx.effect 跳过。
       * 只有 ctx 完全不是对象时才拒绝。
       */
      if (typeof ctx !== 'object' || ctx === null) {
        record('register-failed ctx 不是对象')
        throw new Error(`[${ID}] 宿主传入的 ctx 不是对象`)
      }

      const mod = await loadModule()
      const apply = typeof mod.apply === 'function'
        ? mod.apply
        : (mod.default && typeof mod.default.apply === 'function' ? mod.default.apply : null)

      if (!apply) {
        record('register-failed no-apply-export')
        throw new Error(`[${ID}] lib/index.js 没有导出 apply(ctx)`)
      }

      await apply(ctx)
      applied = true
      log(ctx, `register-ok name=${mod.name || ID} inject=${JSON.stringify(mod.inject || [])}`)
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      const where = String(error && error.stack ? error.stack : '').split('\n')[1] ?? ''
      record(`register-failed ${message}${where ? ` | ${where.trim()}` : ''}`)
      throw error
    }
  },

  async unregister() {
    applied = false
    activeCtx = null
    record('unregister')
  },

  // 给宿主外壳与调试用的只读状态，不参与业务
  status() {
    return { id: ID, version: GENERATION, applied, marker: markerPath() }
  },
}

module.exports = plugin
module.exports.default = plugin
