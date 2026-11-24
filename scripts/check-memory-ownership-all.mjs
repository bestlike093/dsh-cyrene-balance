/*
 * check-memory-ownership-all.mjs —— 记忆开关「全表面单编辑口」闸（pet-ownership 终态 · 2026-11-24 落刀后）
 *
 * 裁决：memoryEnabled 语义键的编辑权威唯一在 DSH 插件侧 schema（lib/settings-schema.mjs）；
 * 桌宠面 companion.memory.enabled 转只读派生（readonly:true，renderer 支持 disabled 不绑提交）；
 * 同步表 main.mjs memoryEnabled 字段拆成只拉不推（pullOnly:true，push 循环跳过）；
 * settings.js 的手写 change→patch 监听已退役。
 *
 * 判据（编辑口计数 A1+A2+A3+A4 必须==1，且 A5 单向绑成立）：
 *   A1 DSH schema memoryEnabled 可编辑字段（权威，应为 1）
 *   A2 DSH 陪伴面板 checkbox 写点（yi2 已退役，应为 0）
 *   A3 桌宠 schema 字段存在且【非】readonly（应为 0；readonly:true 则不计编辑口）
 *   A4 桌宠 settings.js memory enabled 的 patch 写通道（应为 0）
 *   A5 同步表 memoryEnabled 字段带 pullOnly:true（双向绑已拆的证据）
 *
 * 用法：node scripts/check-memory-ownership-all.mjs
 *   code=0 绿 / 1 红 / 2 环境不满足
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r/g, '')

let libSchema, petSchema, petJs, client, main
try {
  libSchema = read('lib/settings-schema.mjs')
  petSchema = read('pet/standalone/apps/desktop/electron/renderer/pet-settings-schema.js')
  petJs = read('pet/standalone/apps/desktop/electron/renderer/settings.js')
  client = read('lib/client.js')
  main = read('pet/standalone/apps/desktop/electron/main.mjs')
} catch (e) {
  console.log('  SKIP 源读不到：' + (e?.message ?? e))
  console.log('[END] script=check-memory-ownership-all.mjs code=2')
  process.exit(2)
}

const results = []
const entries = []

const a1 = /key:\s*'memoryEnabled'/.test(libSchema)
results.push([a1, 'A1·DSH schema 唯一编辑权威存在', a1 ? '' : '缺 memoryEnabled 字段'])
if (a1) entries.push('DSH schema')

const a2 = !/memoryEnabled:\s*event\.target\.checked/.test(client)
results.push([a2, 'A2·DSH 陪伴面板无写点', a2 ? '' : '陪伴面板仍在写 memoryEnabled'])
if (!a2) entries.push('DSH 面板')

const petField = /field\('companion\.memory\.enabled'[\s\S]{0,600}?\n  \}\)/.exec(petSchema)
const a3 = petField === null ? true : /readonly:\s*true/.test(petField[0])
results.push([a3, 'A3·桌宠 schema 字段只读（或不存在）',
  a3 ? (petField === null ? '字段不在表' : 'readonly 成立') : '仍是可编辑字段，计入编辑口'])
if (!a3) entries.push('桌宠 schema')

// 精确到 patch 形态 companion:{memory:{enabled:，避免误伤 axes 记忆轴默认值表
const a4 = !/companion:\s*\{\s*memory:\s*\{\s*enabled:/.test(petJs)
results.push([a4, 'A4·桌宠 settings.js 无 memory.enabled 写通道', a4 ? '' : '仍有 patch 写点'])
if (!a4) entries.push('桌宠 patch')

const memBind = /\{\s*dsh:\s*'memoryEnabled'[^}]*\}/.exec(main)
const a5 = memBind !== null && /pullOnly:\s*true/.test(memBind[0])
results.push([a5, 'A5·同步表 memoryEnabled 只拉不推', a5 ? '' : '双向绑仍在或未声明 pullOnly'])

const ok = entries.length === 1 && a1 && a2 && a3 && a4 && a5
for (const [pass, name, note] of results) console.log(`  ${pass ? 'OK ' : 'RED'} ${name}${pass ? '' : '  ' + note}`)
console.log(`  编辑口实测 ${entries.length}：${entries.join('、') || '无'}`)
console.log(`[check-memory-ownership-all] 红 ${ok ? 0 : 1} 条`)
console.log(`[END] script=check-memory-ownership-all.mjs code=${ok ? 0 : 1}`)
process.exit(ok ? 0 : 1)
