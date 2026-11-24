#!/usr/bin/env node
/**
 * 仓根垃圾文件出生即红（11-17 裁定）。
 *
 * 起因：仓根躺着两个 0 字节文件，名字是 `console.log('` 和 `fs.existsSync(c)` ——
 * node -e 里的箭头函数 `=>` 撞上 cmd 的 `>` 重定向，引号一断，代码尾巴变成文件名。
 * 光清产物，机制还活着，下轮照样掉新的。所以让第三块一出生就被看见。
 *
 * 判据：仓根**一层**里，0 字节 + 名字含可疑字符（( ) ' " 空格 => fs. console. require），即红。
 * 正常空文件（如 .gitkeep 之类）不命中，避免误伤。
 *
 * 用法：node scripts/check-root-junk.mjs [--self-test]
 * 退出码：0 = 干净；1 = 有命中
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SUSPECT = /[()'"\s]|=>|^fs\.|^console\.|^require\(|\bexistsSync\b/

function scan(dir) {
  const out = []
  let es = []
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of es) {
    const abs = path.join(dir, e.name)
    let st
    try { st = fs.statSync(abs) } catch { continue }
    if (!st.isFile()) continue
    /*
     * 2026-11-23 裁定扩口径：可疑名**不论大小**都报。
     * 原先这里有一句 if (st.size !== 0) continue，把有内容的野文件全放过——而 18:20 真实出现的
     * `document.getElementById(id)`（47 字节，内容 MUT_LINE_NOT_FOUND 未还原）正是那个形状，恰好照不到。
     * 门只认 0 字节，等于默认放行「有内容的残留」，跟空集假绿同一族。
     * 分级处理：0 字节多半是 shell 事故残渣；有内容的不自动判死（可能是正当临时件），标成待人工核对。
     */
    if (!SUSPECT.test(e.name)) continue
    out.push({ name: e.name, size: st.size, kind: st.size === 0 ? 'shell-residue' : 'needs-review' })
  }
  return out
}

if (process.argv.includes('--self-test')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rj-'))
  let code = 0
  try {
    fs.writeFileSync(path.join(tmp, "console.log('"), '')
    fs.writeFileSync(path.join(tmp, 'fs.existsSync(c)'), '')
    fs.writeFileSync(path.join(tmp, '.gitkeep'), '')
    fs.writeFileSync(path.join(tmp, 'normal-empty.txt'), '')
    fs.writeFileSync(path.join(tmp, 'has-bytes.txt'), 'x')
    // 18:20 那种形状：有内容 + 可疑名。扩口径前它被 size!==0 放过，这帧就是钉它必须被照到。
    fs.writeFileSync(path.join(tmp, 'document.getElementById(id)'), 'MUT_LINE_NOT_FOUND 未还原，需手工核对\n')
    const hit = scan(tmp)
    const residue = hit.filter((h) => h.kind === 'shell-residue')
    const review = hit.filter((h) => h.kind === 'needs-review')
    if (hit.length !== 3) {
      console.error(`[check-root-junk] 自检 FAIL：应命中 3 条（2 残渣 + 1 待核对），实得 ${hit.length}（${hit.map((h) => h.name).join(', ')}）`)
      code = 1
    }
    if (residue.length !== 2 || review.length !== 1) {
      console.error(`[check-root-junk] 自检 FAIL：分级错了，残渣 ${residue.length}/2、待核对 ${review.length}/1`)
      code = 1
    }
    if (review.length === 1 && !(review[0].size > 0)) {
      console.error('[check-root-junk] 自检 FAIL：needs-review 那件 size 竟然不大于 0')
      code = 1
    }
    if (hit.some((h) => h.name === '.gitkeep' || h.name === 'normal-empty.txt' || h.name === 'has-bytes.txt')) {
      console.error('[check-root-junk] 自检 FAIL：误伤了正常空文件或正常名有内容件')
      code = 1
    }
    if (code === 0) console.log('[check-root-junk] 自检 PASS：可疑名不论大小都报（0B 归残渣 / 有内容归待核对），.gitkeep / 正常名 / 正常有内容件不误伤')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log(`[check-root-junk] 自检临时目录已清理: ${fs.existsSync(tmp) ? '✗ 残留' : '✓'}`)
  }
  console.log('[END] script=check-root-junk.mjs code=' + (code) + ' exitArg=code');
  process.exit(code)
}

const hits = scan(ROOT)
if (hits.length) {
  const residue = hits.filter((h) => h.kind === 'shell-residue')
  const review = hits.filter((h) => h.kind === 'needs-review')
  console.error(`[check-root-junk] FAIL：仓根出现 ${hits.length} 个可疑文件名片段（0 字节 ${residue.length}、有内容 ${review.length}）`)
  residue.forEach((h) => console.error(`  [疑 shell 事故残渣] ${JSON.stringify(h.name)}`))
  review.forEach((h) => console.error(`  [需人工核对是否未还原变异] ${JSON.stringify(h.name)}  ${h.size} 字节`))
  console.error('  成因大概率是 cmd 重定向撞上 node -e 里的 => 或引号断裂，代码尾巴变成了文件名；改用脚本文件执行，别在 cmd 里拼。')
  console.error('  有内容那类不自动判死：可能是正当临时件，但 18:20 真实掉过 MUT_LINE_NOT_FOUND 这种残留标记，务必逐个看过再删。')
  console.log('[END] script=check-root-junk.mjs code=1');
  process.exit(1)
}
console.log('[check-root-junk] OK：仓根无可疑文件名片段（0 字节与有内容都查）')
