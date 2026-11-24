/*
 * check-repair-bounded.mjs —— 修复链带界闸（2026-11-24 地基审计逮到的 while(dirty) 落闸）
 *
 * 断言（两份 speech-habits 副本同标准）：
 *   B1 静态：flush 的 while (dirty) 环必须带回合上限结构（计数 + break）。
 *   B2 行为：沙箱执行 flush 函数体，mock 的每次 writeFile 都 bump mutation（写永远追不平的
 *      最坏竞争）——无上限版本会一路补写触发 60 轮熔断（红）；带界版本 ≤3 轮让位、dirty 保留（绿）。
 *
 * 用法：node scripts/check-repair-bounded.mjs   code=0 绿 / 1 红
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  'lib/companion/persona/speech-habits.mjs',
  'pet/standalone/apps/desktop/electron/speech-habits.mjs',
]

/** 花括号计数提取 `async function flush() {` 起始的完整函数源文。 */
function extractFlush(src) {
  const start = src.indexOf('async function flush() {')
  if (start === -1) return null
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/** 沙箱探针：闭包变量齐备，fs 用 mock，每次 writeFile 前 bump mutation。 */
async function runProbe(flushSrc) {
  const shared = { writes: 0, bump: () => {} }
  const fsMock = {
    mkdir: async () => {},
    rename: async () => {},
    unlink: async () => {},
    writeFile: async () => {
      shared.writes += 1
      if (shared.writes > 60) throw new Error('FUSE:60')
      shared.bump()
    },
  }
  const make = new Function('fs', 'path', 'filePath', 'log', 'registerBump', `
    let dirty = true, mutation = 0, saving = null, loadError = null
    let seal = null, legacyPending = false, legacyPath = null
    const state = { scopes: {}, learning: true }
    registerBump(() => { mutation += 1 })
    ${flushSrc}
    return async () => {
      let outcome = null
      try { outcome = await flush() } catch (e) { outcome = { ok: false, fuse: String(e?.message ?? e) } }
      return { outcome, dirty, mutation }
    }
  `)
  const run = make(fsMock, { dirname: (s) => '.' + s.slice(0, 0) }, 'x.json', () => {}, (b) => { shared.bump = b })
  const r = await run()
  return { ...r, writes: shared.writes }
}

const results = []
for (const rel of TARGETS) {
  let src = ''
  try {
    src = readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
  } catch (e) {
    results.push([false, `B1·${rel} flush 带回合上限`, '源读不到：' + (e?.message ?? e)])
    continue
  }
  const flushSrc = extractFlush(src)
  if (flushSrc === null) {
    results.push([false, `B1·${rel} flush 带回合上限`, 'flush 函数找不到'])
    continue
  }
  const hasLoop = /while\s*\(dirty\)/.test(flushSrc)
  const hasCap = /\b\w*(rounds|attempt)\w*\s*(>=|>|===)\s*\d+/i.test(flushSrc)
  results.push([hasLoop && hasCap, `B1·${rel} while(dirty) 带回合上限`,
    `while(dirty)=${hasLoop} 上限结构=${hasCap}`])
  try {
    const probe = await runProbe(flushSrc)
    const fuse = /FUSE/.test(probe.outcome?.fuse ?? '')
    // 防假绿：flush 正常走完（ok:true）才算数；mock 缺件导致的异常退出不是绿。
    const bounded = probe.outcome?.ok === true && !fuse && probe.writes <= 4 && probe.dirty === true
    results.push([bounded, `B2·${rel} 最坏竞争探针 ≤3 轮让位、dirty 保留`,
      `写 ${probe.writes} 轮，收尾 dirty=${probe.dirty} ok=${String(probe.outcome?.ok ?? '?')}${fuse ? '（60 轮熔断：无上限）' : ''}${probe.outcome && probe.outcome.ok !== true && !fuse ? `（异常：${JSON.stringify(probe.outcome).slice(0, 90)}）` : ''}`])
  } catch (e) {
    results.push([false, `B2·${rel} 最坏竞争探针`, '探针异常：' + (e?.message ?? e)])
  }
}

let bad = 0
for (const [pass, name, note] of results) {
  console.log(`  ${pass ? 'OK ' : 'RED'} ${name}${pass ? '' : '  ' + note}`)
  if (!pass) bad += 1
}
console.log(`[check-repair-bounded] 红 ${bad} 条`)
console.log(`[END] script=check-repair-bounded.mjs code=${bad === 0 ? 0 : 1}`)
process.exit(bad === 0 ? 0 : 1)
