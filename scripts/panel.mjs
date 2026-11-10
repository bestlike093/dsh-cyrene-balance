#!/usr/bin/env node
/**
 * 命令行面板：把 state 里已经算好的值摆出来看一眼。
 *
 * 只读：不写 state、不探测位置、不触发任何副作用。
 * 数据全部来自 pet-plugin-state.json 与 running 时落下的 companionTraits；
 * 这里不重算念旧倾向，也不重跑词表——面板显示的是「此刻生效值」。
 *
 * 用法：
 *   node scripts/panel.mjs
 *   node scripts/panel.mjs --state <path>
 *   node scripts/panel.mjs --now 1762739640000   # 固定时间，便于复现
 *   node scripts/panel.mjs --check-contract      # 只检查 @pet/ui 的只读契约
 *   node scripts/panel.mjs --agenda-model        # 演示桌面版：节目单由模型生成
 *   node scripts/panel.mjs --digest-wired        # 演示桌面版：摘要已接生成器
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPanelView } from '../lib/companion/system/panel-view.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CONTRACT_PATH = join(ROOT, 'pet', 'standalone', 'packages', 'ui', 'dist', 'settings', 'types.d.ts')

const args = process.argv.slice(2)
function argOf(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

/* @pet/ui 那份 dist 的只读契约：字段名必须一直是这两个。 */
async function checkContract() {
  let source = ''
  try {
    source = await readFile(CONTRACT_PATH, 'utf8')
  } catch {
    console.error(`找不到契约文件：${CONTRACT_PATH}`)
    process.exitCode = 1
    return false
  }
  const checks = [
    ['readonly?: boolean', /readonly\?\s*:\s*boolean/],
    ['readonlyReason?: string', /readonlyReason\?\s*:\s*string/],
  ]
  let ok = true
  for (const [label, pattern] of checks) {
    if (pattern.test(source)) {
      console.log(`ok    ${label}`)
    } else {
      console.log(`FAIL  ${label} 不在 d.ts 里`)
      ok = false
    }
  }
  return ok
}

const statePath = argOf('--state') || join(
  process.env.CYRENE_PET_HOME
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'cyrene-pet'),
  'pet-plugin-state.json',
)

function render(view) {
  const lines = [
    'dsh 桌宠 · 生效值面板',
    `state: ${statePath}`,
    `at:    ${new Date(view.at).toISOString()}`,
    '',
  ]
  for (const group of view.groups) {
    lines.push(`[${group.label}]`)
    for (const field of group.fields) {
      const marks = []
      if (field.origin) marks.push(field.origin)
      if (field.readonlyReason) marks.push(`只读：${field.readonlyReason}`)
      if (field.stale) marks.push('stale=true')
      lines.push(`  ${field.label}  ${field.value}${marks.length ? `  (${marks.join(' / ')})` : ''}`)
      if (field.hint) lines.push(`    ${field.hint}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

if (args.includes('--check-contract')) {
  const ok = await checkContract()
  if (ok) {
    console.log('')
    console.log('CONTRACT_OK  只验字段仍在 d.ts；ui 侧会不会渲染 kind=readonly 未验证（dist 无 src，外壳仍未接）')
  }
  process.exitCode = ok ? 0 : 1
} else {
  try {
    const raw = await readFile(statePath, 'utf8')
    const state = JSON.parse(raw)
    const fixedNow = Number(argOf('--now'))
    const view = buildPanelView({
      settings: state,
      derived: {
        companionTraits: state.companionTraits,
        /* 最近一次气泡原文不在 state 里，命令行这格留空。 */
        baseText: '',
      },
      /*
       * 命令行面板代表插件版外壳：节目单来自 schedule.mjs 的七条固定时刻，
       * 人格摘要没有挂载点。两个 -- 开关只用于对照桌面版那一侧，不改变实际行为。
       */
      capabilities: {
        autoLocateProbe: args.includes('--probe-wired'),
        agendaSource: args.includes('--agenda-model') ? 'model' : 'fixed',
        personaDigest: args.includes('--digest-wired'),
      },
      now: Number.isFinite(fixedNow) && fixedNow > 0 ? fixedNow : Date.now(),
    })
    console.log(render(view))
  } catch (error) {
    console.error(`读不到 state：${statePath}`)
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  }
}
