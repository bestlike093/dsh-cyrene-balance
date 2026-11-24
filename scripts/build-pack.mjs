#!/usr/bin/env node
/**
 * build-pack.mjs —— 正式出包尺（Step0 病根的制度化：手拼包 + overlay 复制 = 混装）
 *
 * 病根三条，本尺各配一道死闸：
 *  ①版本双源不同步（manifest 2.0.0 vs package.json 2.0.1）→ V0 不齐拒出包；
 *  ②目标非空 overlay 复制（新 index 盖旧目录、persona 没被盖到）→ V1 目标必须为空；
 *  ③files 面没带 entry/manifest（npm 标准 files 不含 index.cjs）→ INCLUDE 显式全量清单，
 *    树内排除走 build-copy-tree 的事后尺（精确路径段，不看 basename）。
 *
 * 出包后验证四连：入口在位 / persona 三件套真装载（import 包内实体，非静态扫描）/
 * 逐文件 sha256 对源 / pack 面五规则+cred 零命中。清单写 pack-out/（不入库）。
 *
 * 用法：node scripts/build-pack.mjs [--out <目录>] [--self-test]
 * 退出码：0=出包并验证全过 / 1=任一闸红
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { shouldExclude } from './build-copy-tree.mjs'
import { KNOWN_FAKE } from './lib/known-fake.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const sha256Buf = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const sha256File = (p) => sha256Buf(fs.readFileSync(p))

const INCLUDE_ROOT = ['manifest.json', 'package.json', 'index.cjs', 'cordis.patch.yml', 'README.md', 'LICENSE']
const INCLUDE_DIRS = ['lib', 'pet', 'assets']
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml'])

/* pack 面红线规则：与 staged-clean 同源判据（字样拆分，本文件自扫不成命中） */
const PACK_RULES = [
  { id: 'workdir', re: new RegExp('\u6614\u6da6\u5de5\u4f5c\u533a', 'g') },
  { id: 'nickname', re: new RegExp('\u67d2\u67d2', 'g') },
  { id: 'phone', re: new RegExp('1786530' + '8831', 'g') },
  { id: 'userpath', re: /[A-Za-z]:[\\/]Users[\\/][^\\/\s'"]+/g },
  { id: 'drivepath', re: /[A-Za-z]:[\\/](?:\u6614\u6da6|cyrene|project)[^\\/\s'"]*/gi },
  { id: 'cred', re: /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
]
// 假样本白名单已抽到 lib/known-fake.mjs 唯一源（§8.60），此处只 import 不另立名单

function scanPackLeaks(dirAbs) {
  const hits = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) { walk(p); continue }
      if (!TEXT_EXT.has(path.extname(f.name).toLowerCase())) continue
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        for (const r of PACK_RULES) {
          r.re.lastIndex = 0
          const m = r.re.exec(line)
          if (m && !KNOWN_FAKE.has(m[0])) hits.push(`${path.relative(dirAbs, p)}:L${i + 1} ${r.id}`)
        }
      })
    }
  }
  walk(dirAbs)
  return hits
}

/** 收集要拷的文件：相对路径 → 绝对源路径 */
function collectFiles() {
  const map = new Map()
  for (const f of INCLUDE_ROOT) {
    if (fs.existsSync(path.join(ROOT, f))) map.set(f, path.join(ROOT, f))
  }
  for (const dir of INCLUDE_DIRS) {
    const base = path.join(ROOT, dir)
    if (!fs.existsSync(base)) continue
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name)
        const rel = path.relative(ROOT, p).replace(/\\/g, '/')
        if (f.isDirectory()) {
          if (!shouldExclude(rel).excluded) walk(p)
          continue
        }
        if (!shouldExclude(rel).excluded) map.set(rel, p)
      }
    }
    walk(base)
  }
  return map
}

async function verifyPack(outAbs, srcMap) {
  const fails = []
  // 1) 入口在位
  const mf = readJson(path.join(outAbs, 'manifest.json'))
  if (!fs.existsSync(path.join(outAbs, mf.entry || 'index.cjs'))) fails.push('入口缺失: ' + (mf.entry || 'index.cjs'))
  // 2) persona 三件套装载实证（import 包内实体）
  try {
    const mod = await import('file:///' + path.join(outAbs, 'lib/persona.mjs').replace(/\\/g, '/'))
    for (const n of ['buildPersonaPrompt', 'buildPersonaCoreText', 'buildNowPrompt']) {
      if (typeof mod[n] !== 'function') fails.push('包内装载缺导出: ' + n)
    }
  } catch (e) { fails.push('包内 persona 装载失败: ' + e.message.slice(0, 80)) }
  // 3) 逐文件 hash 对源
  let mismatch = 0
  for (const [rel, srcAbs] of srcMap) {
    const dst = path.join(outAbs, rel)
    if (!fs.existsSync(dst) || sha256File(dst) !== sha256File(srcAbs)) mismatch += 1
  }
  if (mismatch > 0) fails.push(`逐文件 hash 对源不一致 ${mismatch} 个`)
  // 4) pack 面红线
  const leaks = scanPackLeaks(outAbs)
  // 验证清单自身的行不参与扫描——先删后写
  if (leaks.length > 0) fails.push('pack 面红线命中: ' + leaks.slice(0, 6).join(' | '))
  return { fails, entryOk: !fails.some((f) => f.startsWith('入口缺失')), fileCount: srcMap.size, leaks: leaks.length }
}

// ---------- self-test ----------
if (process.argv.includes('--self-test')) {
  const t = path.join(ROOT, 'pack-out', '__selftest')
  try {
    fs.mkdirSync(t, { recursive: true })
    fs.writeFileSync(path.join(t, 'poison.md'), '\u5e2e \u67d2\u67d2 C:\\Users\\probeuser/x ' + 'sk-' + 'ABCDEFGHIJKLMNOPQRSTU', 'utf8')
    const hits = scanPackLeaks(t)
    const ids = new Set(hits.map((h) => h.split(' ').pop()))
    const need = ['nickname', 'userpath', 'cred']
    const miss = need.filter((x) => !ids.has(x))
    console.log(`自检: 阳性命中 ${hits.length} 条 [${[...ids].join(',')}] → ${miss.length === 0 ? 'PASS' : 'FAIL 漏 ' + miss.join(',')}`)
    process.exitCode = miss.length === 0 ? 0 : 1
  } finally {
    fs.rmSync(t, { recursive: true, force: true })
  }
  console.log(`[END] script=build-pack.mjs code=${process.exitCode}`)
  process.exit(process.exitCode)
}

// ---------- 正式出包 ----------
const oi = process.argv.indexOf('--out')
const outAbs = oi > 0 && process.argv[oi + 1] ? path.resolve(process.argv[oi + 1]) : path.join(ROOT, 'pack-out', 'dsh-cyrene-pet-' + readJson(path.join(ROOT, 'manifest.json')).version)

// V0 双源版本一致
const manVer = readJson(path.join(ROOT, 'manifest.json')).version
const pkgVer = readJson(path.join(ROOT, 'package.json')).version
if (manVer !== pkgVer) {
  console.log(`V0 RED 版本双源不同步: manifest=${manVer} package=${pkgVer}——先对齐再出包`)
  console.log('[END] script=build-pack.mjs code=1')
  process.exit(1)
}
// V1 目标必须空（overlay 病根制度化）
if (fs.existsSync(outAbs) && fs.readdirSync(outAbs).length > 0) {
  console.log(`V1 RED 目标非空，拒绝 overlay 复制: ${outAbs}`)
  console.log('[END] script=build-pack.mjs code=1')
  process.exit(1)
}
fs.mkdirSync(outAbs, { recursive: true })
const srcMap = collectFiles()
for (const [rel, srcAbs] of srcMap) {
  const dst = path.join(outAbs, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(srcAbs, dst)
}
const v = await verifyPack(outAbs, srcMap)
// 总清单落包旁
const list = [...srcMap.keys()].sort().map((rel) => `${rel}  ${sha256File(path.join(outAbs, rel))}`)
fs.writeFileSync(path.join(outAbs, 'PACK-MANIFEST.sha256.txt'), list.join('\n') + '\n', 'utf8')
console.log(`版本=${manVer} 文件=${v.fileCount} 装载实证=${v.fails.every((f) => !f.includes('装载')) ? 'PASS' : 'FAIL'}`)
for (const f of v.fails) console.log('  VERIFY RED: ' + f)
console.log(v.fails.length === 0 ? '四连验证全过: ' + outAbs : '出包未过闸')
console.log(`[END] script=build-pack.mjs code=${v.fails.length === 0 ? 0 : 1}`)
process.exit(v.fails.length === 0 ? 0 : 1)
