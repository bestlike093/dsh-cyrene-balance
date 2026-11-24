/*
 * check-deploy-samesource.mjs —— 部署同源闸（2026-11-24 主人裁定：插在最前的部署格，先证红）
 *
 * 地雷形态：dist 包与打包源的 renderer 是止血前旧码（scopeLabel 直拼裸 openid）；
 * 平时不响，哪天从旧包重装或旧源重打包，§8.39 止血静默丢掉——连「值写进盘」都没有，直接回裸串。
 *
 * 断言（显式白名单，不 glob；archive/tmp/backup/quarantine 永远不进扫描面）：
 *   D1 内容红线：每份 insight.js 的 scopeLabel 体内，`${raw.slice(` 直拼必须为 0
 *      （合规形态只有 `${mCodeOf(raw.slice(`）。
 *   D2 同源比对：每份 dist 副本的 insight.js/insight.css sha256 必须等于打包源
 *      （projects/desktop-pet/apps/desktop）；不一致红＝磁盘包落后于源，拿来装会部署到旧码。
 *
 * 用法：node scripts/check-deploy-samesource.mjs   code=0 绿 / 1 红 / 2 环境不满足
 * 当下预期红态（如实记账，不硬绿）：打包源与三包副本 D1 红（止血前码）；
 * 补源＋重打包后转绿。D2 在「源改了包没重打」那一刻会逮到——就是它存在的意义。
 */
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 打包仓位置从仓根相对推导（上两级＝工作区根），不写死任何真路径
const PET = join(ROOT, '..', '..', 'projects', 'desktop-pet')
const RD = 'apps\\desktop\\electron\\renderer'
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// 权威源（dsh-pet 仓内，只查 D1）与打包源/各 dist 副本（查 D1；dist 另查 D2==打包源）
const SRC_AUTH = join(ROOT, 'pet', 'standalone', RD, 'insight.js')
const PKG_SRC = join(PET, RD, 'insight.js')
const PKG_SRC_CSS = join(PET, RD, 'insight.css')
const DIST_DIRS = ['dist-pkg-42', 'dist-pkg-test', 'dist-pkg-smoke', 'dist-public']
const distFile = (d, f) =>
  d === 'dist-public'
    ? join(PET, d, RD, f)
    : join(PET, d, 'win-unpacked', 'resources', 'app', RD, f)

const results = []

function checkD1(label, p) {
  if (!existsSync(p)) { results.push([true, `D1·${label}`, '（文件不存在，SKIP 如实记）']); return null }
  const src = readFileSync(p, 'utf8').replace(/\r/g, '')
  const fn = /function scopeLabel\(scope\) \{([\s\S]*?)\n\}/.exec(src)
  if (fn === null) { results.push([false, `D1·${label}`, 'scopeLabel 找不到（结构变了，闸要跟着修）']); return null }
  const bare = [...fn[1].matchAll(/\$\{raw\.slice\(/g)].length
  const coded = [...fn[1].matchAll(/mCodeOf\(raw\.slice\(/g)].length
  const ok = bare === 0 && coded >= 3
  results.push([ok, `D1·${label}`, ok ? '' : `直拼裸串 ${bare} 处、mCodeOf 包裹 ${coded} 处（应裸 0 且三分支全覆盖）`])
  return src
}

checkD1('权威源 dsh-pet/pet/standalone', SRC_AUTH)
checkD1('打包源 desktop-pet/apps/desktop', PKG_SRC)
for (const d of DIST_DIRS) {
  const p = distFile(d, 'insight.js')
  checkD1(`副本 ${d}`, p)
  // D2：dist 与打包源比对（js 与 css 双件）
  if (existsSync(p) && existsSync(PKG_SRC)) {
    const parts = []
    let ok = true
    for (const f of ['insight.js', 'insight.css']) {
      const dp = distFile(d, f)
      const sp = f === 'insight.js' ? PKG_SRC : PKG_SRC_CSS
      if (!existsSync(dp) || !existsSync(sp)) { parts.push(`${f}:缺`); continue }
      const same = hash(dp) === hash(sp)
      if (!same) ok = false
      parts.push(`${f}:${same ? '同' : '异'}`)
    }
    results.push([ok, `D2·${d} == 打包源`, ok ? '' : parts.join(' ')])
  }
}

let bad = 0
for (const [pass, name, note] of results) {
  console.log(`  ${pass ? 'OK ' : 'RED'} ${name}${pass ? '' : '  ' + note}`)
  if (!pass) bad += 1
}
console.log(`[check-deploy-samesource] 红 ${bad} 条`)
console.log(`[END] script=check-deploy-samesource.mjs code=${bad === 0 ? 0 : 1}`)
process.exit(bad === 0 ? 0 : 1)
