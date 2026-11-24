/**
 * 宿主身份采集 —— 单一真源（§18 规格）
 *
 * 为什么要有这个文件：
 *   mounted 行过去只写 pid，而 pid 会复用；marker 又只由 index.cjs 写，
 *   DSH 走 package.json main 进 lib/index.js，那条路上一个字都不留。
 *   结果是「谁把桌宠拉起来的」在日志里无法归因，只能事后靠人翻进程表猜。
 *
 * 五件同记（缺一即标不可用，绝不事后按 pid 猜补）：
 *   hostPkg    宿主包 name（DSH=@deepseek-ai/dsh-desktop，Cyrene=cyrene-agent）
 *   hostVer    宿主包 version
 *   hostPid    宿主进程 pid
 *   launcherPid     拉起者 pid
 *   launcherCmdHash 拉起者命令行归一化后的 sha256 前 12 位
 *
 * 归一化规则（写死，不随实现漂移）：
 *   丢掉：--type=*、--parent-pid=*、任何 pid 数字、时间戳、随机 token、
 *         绝对路径盘符前缀、profile 目录、user-data-dir 的取值
 *   保留：exe 文件名 + 稳定 flag 名集合（排序后参与哈希）
 *   目的：同一宿主两次启动必须同 hash；不同宿主必须不同 hash。
 *
 * 时点纪律：父进程命令行只在 boot 当时取得到（33680 退场后就没了），
 *   所以本模块只负责「当场取」，取不到一律写 [launcherUnavailable·当时未取]。
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, statSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const UNAVAILABLE = '[launcherUnavailable·当时未取]'

/**
 * 从 asar 归档里取 package.json 的 name/version。
 * 只读头部 header，不解包整档；asar 头布局固定：
 *   [0..4) 4  [4..8) headerSize  [8..12) headerObjectSize  [12..16) headerStringSize
 */
function readAsarPackage(asarPath) {
  try {
    if (!existsSync(asarPath) || !statSync(asarPath).isFile()) return null
    const fd = openSync(asarPath, 'r')
    try {
      const head = Buffer.alloc(16)
      readSync(fd, head, 0, 16, 0)
      const jsonSize = head.readUInt32LE(12)
      if (!(jsonSize > 0 && jsonSize < 64 * 1024 * 1024)) return null
      const buf = Buffer.alloc(jsonSize)
      readSync(fd, buf, 0, jsonSize, 16)
      const tree = JSON.parse(buf.toString('utf8').replace(/\0+$/, ''))
      const node = tree?.files?.['package.json']
      if (!node || typeof node.offset === 'undefined') return null
      const base = 8 + jsonSize
      const body = Buffer.alloc(node.size)
      readSync(fd, body, 0, node.size, base + Number(node.offset))
      const pkg = JSON.parse(body.toString('utf8'))
      if (!pkg || typeof pkg.name !== 'string') return null
      return { name: pkg.name, version: String(pkg.version ?? '') }
    } finally { closeSync(fd) }
  } catch {
    return null
  }
}

/** 从 exe 路径往上找最近的 package.json，认宿主包名（解包安装形态用）。 */
function walkUpForHostPackage(startDir) {
  let dir = startDir
  for (let i = 0; i < 6 && dir && dir !== dirname(dir); i++) {
    const candidate = join(dir, 'package.json')
    try {
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSyncUtf8(candidate))
        if (pkg && typeof pkg.name === 'string' && /dsh|cyrene|deepseek/i.test(pkg.name)) {
          return { name: pkg.name, version: String(pkg.version ?? '') }
        }
      }
    } catch { /* 读不了就继续往上 */ }
    dir = dirname(dir)
  }
  return null
}

function readFileSyncUtf8(p) {
  // 局部小工具：避免在顶层再引一个 fs 默认导出，保持 import 面窄
  const fd = openSync(p, 'r')
  try {
    const size = statSync(p).size
    const buf = Buffer.alloc(size)
    readSync(fd, buf, 0, size, 0)
    return buf.toString('utf8')
  } finally { closeSync(fd) }
}

/**
 * 认宿主包身份。三条来源按可信度依次尝试，认不出就返回 UNAVAILABLE，绝不猜。
 *   1. 命令行里出现 app.asar → 直接读 asar 内 package.json（DSH 是这条路）
 *   2. 命令行里出现 exe 路径 → 从 exe 目录往上找 package.json（解包安装形态）
 *   3. 环境变量 DSH_HOST_PACKAGE / DSH_HOST_VERSION（宿主显式声明时用）
 */
export function resolveHostPackage(cmdline) {
  const cmd = typeof cmdline === 'string' ? cmdline : ''
  const asar = cmd.match(/([A-Za-z]:[\\/][^"]*?app\.asar)(?=["\\\s]|$)/)
  if (asar) {
    const got = readAsarPackage(asar[1])
    if (got) return got
  }
  const exe = cmd.match(/"([A-Za-z]:[^"]+?\.exe)"/) ?? cmd.match(/([A-Za-z]:\S+?\.exe)/)
  if (exe) {
    const got = walkUpForHostPackage(dirname(exe[1]))
    if (got) return got
  }
  const envName = process.env.DSH_HOST_PACKAGE
  if (envName) return { name: envName, version: process.env.DSH_HOST_VERSION ?? '' }
  return null
}

/** 稳定 flag：参与哈希的白名单。不在表里的 flag 一律丢掉（含取值）。 */
const STABLE_FLAGS = Object.freeze([
  '--expose-internals',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port',
  '--dsh-pet-owner',
])

/**
 * 按 Windows 习惯切命令行：双引号内的空格算一个 token。
 * 不能直接 split(/\s+/) —— "DeepSeek Harness.exe" 会被切成三截，
 * 同一宿主换个安装目录就散成完全不同的 token 集，哈希随之漂移。
 */
function tokenize(cmdline) {
  const out = []
  let cur = '', inQuote = false
  for (const ch of cmdline) {
    if (ch === '"') { inQuote = !inQuote; continue }
    if (ch === ' ' && !inQuote) { if (cur !== '') out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur !== '') out.push(cur)
  return out
}

/** 随启动/机器变化的 flag：整条丢弃，连名字都不留（留着名字仍会因多一个少一个漂移）。 */
const DROP_FLAGS = Object.freeze([
  '--type', '--parent-pid', '--user-data-dir', '--gpu-preferences',
  '--standard-schemes', '--secure-schemes', '--cors-schemes',
  '--fetch-scheme-suffixes', '--cors-scheme', '--fetch-scheme',
])

/**
 * 把一条命令行归一成稳定 token 列表。
 * 只做减法：去掉会随每次启动变化的东西，留下能标识「这是哪个宿主」的东西。
 */
export function normalizeCommandLine(cmdline) {
  if (typeof cmdline !== 'string' || cmdline.trim() === '') return []
  const raw = tokenize(cmdline)
  const out = []
  for (let tok of raw) {
    // 值里带 = 的长串（--user-data-dir=C:\Users\…）整串当 flag 名，取值一律丢
    const eq = tok.indexOf('=')
    if (eq > 0 && /^--/.test(tok)) tok = tok.slice(0, eq)
    const name = tok.split('=')[0]
    // 子进程角色、父 pid、profile 目录、Chromium 环境相关串：整条丢
    if (DROP_FLAGS.includes(name)) continue
    // 任何带 = 却没进白名单的 flag，取值都不可信，只留 flag 名
    const stable = STABLE_FLAGS.includes(name)
    if (!stable && /^--/.test(name)) continue
    // 纯随机值（flag 值、nonce、时间戳）丢掉
    if (/^[0-9a-f]{8,}$/i.test(tok) || /^\d{10,}$/.test(tok)) continue
    // 其余一律按「可能是路径」处理：有目录分隔符就只取文件名
    if (tok.includes('\\') || tok.includes('/')) {
      const base = tok.split(/[\\/]/).filter(Boolean).pop() ?? ''
      if (/^[\d.\-:]+$/.test(base)) continue
      if (/\.(exe|node|dll|asar)$/i.test(base)) out.push(base.toLowerCase())
      continue
    }
    // 带扩展名却没路径的裸词（命令行里少见），也收进 exe 面
    if (/\.(exe|node|dll|asar)$/i.test(tok)) { out.push(tok.toLowerCase()); continue }
    // 纯数字丢掉（pid、端口、超时之类）
    if (/^\d+$/.test(tok)) continue
    // 其余裸词（如子命令名）保留，它们通常稳定
    out.push(tok)
  }
  // 排序去重：同一组 token 换个先后顺序不该算两个宿主
  return [...new Set(out)].sort()
}

/** 归一化后的 token 列表 → 12 位 hash。空列表返回 null（不当成有效身份）。 */
export function hashCommandLine(cmdline) {
  const tokens = normalizeCommandLine(cmdline)
  if (tokens.length === 0) return null
  return createHash('sha256').update(tokens.join(' ')).digest('hex').slice(0, 12)
}

/**
 * 取父进程的 pid 与命令行。跨平台，失败一律返回 null，不抛。
 * 只在 boot 当时调用；调用方负责把结果落盘，事后无法补取。
 */
export function readParentProcess() {
  const ppid = Number(process.ppid)
  if (!Number.isFinite(ppid) || ppid <= 0) return null
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${ppid}'; if ($p) { Write-Output ($p.Name + '|' + $p.CommandLine) }`],
      { encoding: 'utf8', timeout: 8000, maxBuffer: 1 << 20, windowsHide: true })
      const line = String(out).split(/\r?\n/).find((l) => l.includes('|'))
      if (!line) return null
      const idx = line.indexOf('|')
      return { pid: ppid, name: line.slice(0, idx).trim(), cmdline: line.slice(idx + 1).trim() }
    }
    // POSIX：/proc 里拿 ppid 与 cmdline（NUL 分隔）
    const raw = execFileSync('ps', ['-p', String(ppid), '-o', 'args='], { encoding: 'utf8', timeout: 8000 })
    const cmdline = String(raw).trim()
    if (!cmdline) return null
    const base = cmdline.split(/\s+/)[0].split('/').pop()
    return { pid: ppid, name: base, cmdline }
  } catch {
    return null
  }
}

/**
 * 采集宿主身份五件。
 * @param {object} opts
 * @param {string} opts.chain  'main' | 'index.cjs' —— 哪条入口链写的这行，必带，不许省
 * @param {string} [opts.hostPkg]  宿主包 name（入口层已知时传入，避免重复解析）
 * @param {string} [opts.hostVer]  宿主包 version
 * @returns {{chain:string,hostPkg:string,hostVer:string,hostPid:number,launcherPid:string,launcherCmdHash:string,exe:string}}
 */
export function captureHostIdentity(opts = {}) {
  const chain = opts.chain ?? 'unknown'
  const parent = readParentProcess()
  const exe = parent?.name ?? ''
  return {
    chain,
    hostPkg: opts.hostPkg ?? UNAVAILABLE,
    hostVer: opts.hostVer ?? UNAVAILABLE,
    hostPid: parent?.pid ?? process.ppid ?? UNAVAILABLE,
    launcherPid: parent ? String(parent.pid) : UNAVAILABLE,
    launcherCmdHash: hashCommandLine(parent?.cmdline ?? '') ?? UNAVAILABLE,
    exe: exe || UNAVAILABLE,
  }
}

/** 拍平成一行 key=value，直接拼进日志。顺序固定，便于正则解析与 diff。 */
export function formatHostIdentity(id) {
  return `chain=${id.chain} hostPkg=${id.hostPkg} hostVer=${id.hostVer} hostPid=${id.hostPid}`
    + ` launcherPid=${id.launcherPid} launcherCmdHash=${id.launcherCmdHash} launcherExe=${id.exe}`
    + (missingEvidence(id) ? ' evidence=missing' : ' evidence=ok')
}

/**
 * 取证缺失判定 —— 防止 UNAVAILABLE 退化成「取不到就一律填这个」的静默默认。
 * 规则：任一件落 UNAVAILABLE，本行即视为取证缺失，
 *   调用方须在所在帧标 [取证缺失]，这一行不参与宿主归类，
 *   也不许拿它当「宿主未知」以外的任何结论（尤其不能读成「不是 DSH」或「是 Cyrene」）。
 */
export function missingEvidence(id) {
  const vals = [id.hostPkg, id.hostVer, String(id.hostPid), id.launcherPid, id.launcherCmdHash, id.exe]
  return vals.some((v) => v === UNAVAILABLE || v === 'unknown' || v === '' || v === 'undefined')
}

/** 归类入口：取证缺失一律返回 null，让上层显式处理「不可归类」。 */
export function classifyHost(id, knownHosts = {}) {
  if (missingEvidence(id)) return null
  const byExe = Object.entries(knownHosts).find(([, v]) => v && v.toLowerCase() === String(id.exe).toLowerCase())
  if (byExe) return byExe[0]
  const byPkg = Object.entries(knownHosts).find(([, v]) => v === id.hostPkg)
  return byPkg ? byPkg[0] : null
}

/**
 * 一致性校验：evidence=ok 不等于五件齐备，标记本身也可能被写错。
 * 这条负责把「标记」与「字段实际状态」对上，标记撒谎就算红。
 *   1) 行尾写 ok 却缺件 → 红（missing 被标成 ok）
 *   2) 行尾写 missing 却齐备 → 红（齐备被标成 missing，会让真身份被丢）
 *   3) launcherCmdHash 与「按本模块规则重新归一 launcherCmdline 算出的值」不符 → 红
 *      （hash 不是自由文本，它必须可复算；复算不上说明写日志时用了别的规则）
 * @param {object} row  { line: 拍平行原文, fields: 五件, launcherCmdline?: 原始命令行 }
 * @returns {{ok:boolean, why:string}}
 */
export function verifyEvidenceConsistency(row) {
  const line = String(row?.line ?? '')
  const fields = row?.fields ?? null
  if (!fields) return { ok: false, why: '缺五件字段，无法校验' }
  const claimsOk = /evidence=ok\b/.test(line)
  const claimsMissing = /evidence=missing\b/.test(line)
  const reallyMissing = missingEvidence(fields)
  if (claimsOk && reallyMissing) return { ok: false, why: '标记 evidence=ok 但五件有缺' }
  if (claimsMissing && !reallyMissing) return { ok: false, why: '标记 evidence=missing 但五件齐备' }
  if (!claimsOk && !claimsMissing) return { ok: false, why: '行尾缺 evidence 标记' }
  if (typeof row.launcherCmdline === 'string' && row.launcherCmdline !== '') {
    const recomputed = hashCommandLine(row.launcherCmdline)
    if (recomputed !== fields.launcherCmdHash) {
      return { ok: false, why: `launcherCmdHash 复算不符：写 ${fields.launcherCmdHash} / 算 ${recomputed}` }
    }
  }
  return { ok: true, why: '标记与字段一致' }
}

/**
 * 归一化规则的形状断言：一阴一阳。
 * 阴性（同宿主两次启动必须同 hash）不过 = 把每次启动都当成新宿主；
 * 阳性（不同宿主必须不同 hash）不过 = 把 Cyrene 认成 DSH。
 * 两条都过，这个 hash 才有资格当身份用。
 */
export function selfTest() {
  const cases = []
  const eq = (name, a, b) => cases.push({ name, ok: a === b, got: a, want: b })
  const ne = (name, a, b) => cases.push({ name, ok: a !== b, got: a, want: `≠ ${b}` })

  // 阴性：同一宿主两次启动，pid / user-data-dir / gpu-preferences 都不同，hash 必须相同
  const cy1 = '"D:\\cyrene\\Cyrene.exe" --no-sandbox --disable-gpu --user-data-dir="C:\\Users\\a\\AppData\\Roaming\\Cyrene"'
  const cy2 = '"D:\\other\\path\\Cyrene.exe" --disable-gpu --no-sandbox --user-data-dir="C:\\Users\\b\\AppData\\Roaming\\Cyrene" --gpu-preferences=WAAA'
  eq('阴性·同宿主两次启动同 hash', hashCommandLine(cy1), hashCommandLine(cy2))

  const dsh1 = '"C:\\Users\\lenovo\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe" --expose-internals "C:\\...\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js" "C:\\Users\\lenovo\\.dsh"'
  const dsh2 = '"D:\\elsewhere\\DeepSeek Harness.exe" --expose-internals "D:\\x\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js" "D:\\y\\.dsh"'
  eq('阴性·同宿主不同安装路径同 hash', hashCommandLine(dsh1), hashCommandLine(dsh2))

  // 阳性：Cyrene 与 DSH 必须不同 hash
  ne('阳性·Cyrene ≠ DSH', hashCommandLine(cy1), hashCommandLine(dsh1))

  // 阳性：桌宠自身子进程（带 --parent-pid 与 --dsh-pet-owner）不得与宿主同 hash
  const pet = '"C:\\Users\\lenovo\\.dsh\\storages\\cyrene-pet\\runtime\\DeepSeek Harness.exe" --no-sandbox --user-data-dir=C:\\Users\\lenovo\\.dsh\\storages\\cyrene-pet --parent-pid=33680 --dsh-pet-owner=dsh'
  ne('阳性·桌宠子进程 ≠ DSH 宿主', hashCommandLine(pet), hashCommandLine(dsh1))

  // 边界：空串 / 非字符串不得产出 hash（否则 null 会被当成同一个身份）
  eq('边界·空串返回 null', hashCommandLine(''), null)
  eq('边界·undefined 返回 null', hashCommandLine(undefined), null)
  eq('边界·纯随机 token 返回 null', hashCommandLine('9f3a7c2e1b 1700000000000'), null)

  // 归一化明细：--type 与 --parent-pid 必须被丢掉，exe 名必须留下
  const toks = normalizeCommandLine(pet)
  cases.push({ name: '归一·丢 --type/--parent-pid', ok: !toks.some((t) => /^--type=|^--parent-pid=/.test(t)), got: toks.join(' '), want: '不含 --type/--parent-pid' })
  cases.push({ name: '归一·留 exe 名', ok: toks.includes('deepseek harness.exe'), got: toks.join(' '), want: '含 deepseek harness.exe' })
  cases.push({ name: '归一·留稳定 flag', ok: toks.includes('--no-sandbox') && toks.includes('--dsh-pet-owner'), got: toks.join(' '), want: '含 --no-sandbox 与 --dsh-pet-owner' })
  cases.push({ name: '归一·排序去重', ok: toks.join(' ') === [...new Set(toks)].sort().join(' '), got: toks.join(' '), want: '已排序去重' })

  // UNAVAILABLE 是常量，不是猜出来的值
  cases.push({ name: '取不到时标不可用而非猜', ok: UNAVAILABLE === '[launcherUnavailable·当时未取]', got: UNAVAILABLE, want: '[launcherUnavailable·当时未取]' })

  // 取证缺失不得退化成静默默认：任一件缺 → missingEvidence 为真 → 归类返回 null
  const hole = { chain: 'main', hostPkg: UNAVAILABLE, hostVer: UNAVAILABLE, hostPid: 1, launcherPid: '1', launcherCmdHash: 'abcdef123456', exe: 'x.exe' }
  cases.push({ name: '缺一件即算取证缺失', ok: missingEvidence(hole) === true, got: String(missingEvidence(hole)), want: 'true' })
  cases.push({ name: '取证缺失不参与宿主归类', ok: classifyHost(hole, { cyrene: 'cyrene-agent', dsh: '@deepseek-ai/dsh-desktop' }) === null, got: String(classifyHost(hole, { cyrene: 'cyrene-agent' })), want: 'null' })
  const full = { chain: 'main', hostPkg: 'cyrene-agent', hostVer: '1.3.5', hostPid: 3252, launcherPid: '3252', launcherCmdHash: 'c76bae8b2bc4', exe: 'cyrene.exe' }
  cases.push({ name: '五件齐备才算取证完整', ok: missingEvidence(full) === false, got: String(missingEvidence(full)), want: 'false' })
  cases.push({ name: '齐备时可按 exe 归类', ok: classifyHost(full, { cyrene: 'cyrene.exe' }) === 'cyrene', got: String(classifyHost(full, { cyrene: 'cyrene.exe' })), want: 'cyrene' })
  cases.push({ name: '拍平行带 evidence 标记', ok: /evidence=missing$/.test(formatHostIdentity(hole)) && /evidence=ok$/.test(formatHostIdentity(full)), got: formatHostIdentity(hole).slice(-30), want: '行尾 evidence=missing / evidence=ok' })

  // 标记一致性三条：闸门自己也得被验，别退化成「靠标记生效的 role=ref」
  const cmdDsh = '"C:\\Users\\lenovo\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe" --expose-internals "C:\\x\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js" "C:\\Users\\lenovo\\.dsh"'
  const okRow = { chain: 'main', hostPkg: '@deepseek-ai/dsh-desktop', hostVer: '1.0.0', hostPid: 33680, launcherPid: '33680', launcherCmdHash: hashCommandLine(cmdDsh), exe: 'deepseek harness.exe' }
  const okLine = formatHostIdentity(okRow)
  const lie1 = okLine.replace('evidence=ok', 'evidence=missing')   // 齐备却标缺失
  const r1 = verifyEvidenceConsistency({ line: lie1, fields: okRow, launcherCmdline: cmdDsh })
  cases.push({ name: '一致·齐备却标 missing 必红', ok: r1.ok === false, got: r1.why, want: 'ok=false' })
  const lie2 = formatHostIdentity(hole).replace('evidence=missing', 'evidence=ok')  // 缺件却标 ok
  const r2 = verifyEvidenceConsistency({ line: lie2, fields: hole })
  cases.push({ name: '一致·缺件却标 ok 必红', ok: r2.ok === false, got: r2.why, want: 'ok=false' })
  const lie3 = { ...okRow, launcherCmdHash: 'deadbeefcafe' }        // hash 不可复算
  const r3 = verifyEvidenceConsistency({ line: okLine, fields: lie3, launcherCmdline: cmdDsh })
  cases.push({ name: '一致·launcherCmdHash 复算不符必红', ok: r3.ok === false, got: r3.why, want: 'ok=false' })
  const r4 = verifyEvidenceConsistency({ line: okLine, fields: okRow, launcherCmdline: cmdDsh })
  cases.push({ name: '一致·真齐备真复算为绿', ok: r4.ok === true, got: r4.why, want: 'ok=true' })
  // 长得像 DSH 但取证缺失 → 仍不归类（阳例，防「字段像就算数」）
  const lookalike = { chain: 'main', hostPkg: '@deepseek-ai/dsh-desktop', hostVer: UNAVAILABLE, hostPid: 1, launcherPid: UNAVAILABLE, launcherCmdHash: UNAVAILABLE, exe: 'deepseek harness.exe' }
  cases.push({ name: '一致·像 DSH 但缺件仍不归类', ok: classifyHost(lookalike, { dsh: 'deepseek harness.exe' }) === null, got: String(classifyHost(lookalike, { dsh: 'deepseek harness.exe' })), want: 'null' })

  return cases
}
