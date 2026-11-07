'use strict'

/**
 * dsh-cyrene-pet — Cyrene 宿主入口（CJS 适配层）。
 *
 * 宿主认的形态是 { apiVersion, id, register(ctx), unregister() }；
 * 插件主体 lib/index.js 是 Cordis 形态（export name / inject / apply）。
 * 这一层只做桥接，不复制任何业务逻辑。
 */

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ID = 'dsh-cyrene-pet'
const VERSION = '2.0.0'

let modulePromise = null
let activeCtx = null
let applied = false

function markerPath() {
  return path.join(process.env.APPDATA || '', 'Cyrene', `${ID}.marker`)
}

function record(line) {
  try {
    const file = markerPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${new Date().toISOString()} ${line} v${VERSION}\n`, 'utf8')
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
    modulePromise = import(pathToFileURL(entry).href).catch((error) => {
      modulePromise = null
      record(`load-failed ${error && error.message}`)
      throw error
    })
  }
  return modulePromise
}

const plugin = {
  apiVersion: 1,
  id: ID,

  async register(ctx) {
    activeCtx = ctx
    record('register-enter')
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
  },

  async unregister() {
    applied = false
    activeCtx = null
    record('unregister')
  },

  // 给宿主外壳与调试用的只读状态，不参与业务
  status() {
    return { id: ID, version: VERSION, applied, marker: markerPath() }
  },
}

module.exports = plugin
module.exports.default = plugin
