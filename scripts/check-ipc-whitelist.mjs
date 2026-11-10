/**
 * IPC 白名单自检。
 *
 * 背景：main.mjs 的 registerChannel() 第一步就调 assertChannel()，
 * 所以只要有一条「注册了但没进白名单」，整个 registerIpc() 会中途抛错，
 * 窗口、QQ 网关、素材协议全部起不来。历史故障就是 pet:insight:set-intimacy。
 *
 * 用法：node scripts/check-ipc-whitelist.mjs
 * 退出码：0 = 全部对齐；1 = 存在被拦的通道（CI 里可以直接当门禁）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', 'pet', 'standalone', 'apps', 'desktop')

const main = readFileSync(join(app, 'electron', 'main.mjs'), 'utf8')
const ipc = readFileSync(join(app, 'dist', 'ipc.js'), 'utf8')

/* 只统计走 registerChannel 的通道；其余通道由别的注册方式负责，不在这份清单里。 */
const registered = new Set()
for (const m of main.matchAll(/registerChannel\(\s*'([^']+)'/g)) registered.add(m[1])

const start = ipc.indexOf('const IPC_CHANNELS = [')
const end = ipc.indexOf('];', start)
if (start < 0 || end < 0) {
  console.error('找不到 IPC_CHANNELS 数组，dist 结构可能变了')
  process.exit(1)
}
const declared = new Set()
for (const m of ipc.slice(start, end).matchAll(/'([^']+)'/g)) declared.add(m[1])

const blocked = [...registered].filter((c) => !declared.has(c))

console.log(`registerChannel 注册 ${registered.size} 条，白名单声明 ${declared.size} 条`)
if (blocked.length === 0) {
  console.log('OK：没有通道会在启动阶段被拦下')
  process.exit(0)
}

console.error(`被拦下的通道 ${blocked.length} 条：`)
for (const c of blocked) console.error(`  - ${c}`)
console.error('把它们补进 apps/desktop/dist/ipc.js 的 IPC_CHANNELS，否则桌宠会在 registerIpc 中途崩。')
process.exit(1)
