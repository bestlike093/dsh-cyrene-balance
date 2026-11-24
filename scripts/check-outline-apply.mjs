/*
 * check-outline-apply.mjs —— 描边「改了设置那一刻生效」的闸（T-E 格）
 *
 * 判据打在用户体感上：
 *   改 presence.outline 之后，#stage 的 filter 立刻跟着变。
 * 「重启后生效」不算，「源码里写了这一行」也不算。
 *
 * 分辨力在哪：主判据是 G2。G3 是回到起点的一致性检查，第 1 趟没挂上时它天然绿，
 * 别把 G3 的绿当成第二条独立证据。
 *
 * 现状（本轮坐实）：
 *   renderer.mjs:822  autoOutlineStage() → attachAutoOutline({ canvas, prefer: appSettings?.presence?.outline })
 *   renderer.mjs:807  这是全文件唯一一次调用，在模型加载完成时
 *   renderer.mjs:2512 applyUiSettings(next) 处理了模型/主题/气泡/缩放/贴纸/HUD/pose/模块开关，独漏重挂描边
 *   所以值写进盘（实测 presence.outline="dark"）但没人重画，判据当下必红。
 *
 * 三条纪律，别改成方便跑的样子：
 *   1. 颜色期望值不硬编码。深浅两边的实际色值问产品自己的 OUTLINE_COLORS
 *      （renderer/outline.mjs:11），在页面上下文里 import 出来读。
 *      上一路 flow 闸就是靠这条挡住过「解析器算错一处、整份报告就是假的」。
 *   2. 基线立不起描边 → code=2（环境不满足），绝不许报成红。
 *      验证实例是空 profile，可能没有可用立绘；attachAutoOutline 只在采样成功时才
 *      applyOutline（outline.mjs:173），画布空则 filter 永远是空串。
 *      那种情况下「改了不跟随」根本没法判，报红就是把环境问题算成产品缺陷。
 *   3. 判据走来回两趟：先改 dark 再改回 light。只测一趟可能被基线恰好等于期望值蒙绿。
 *
 * 通道是产品自带的，不是测试侧私搭：
 *   preload.cjs:13        saveSettings → invoke('pet:settings:save')
 *   renderer.mjs:3217-3220 onSettingsChanged → applyUiSettings(next)
 *   改设置用 window.pet.saveSettings，读设置用 window.pet.getSettings，整份存回。
 *
 * 用法：node scripts/check-outline-apply.mjs
 *   code=0 通过 / code=1 红 / code=2 环境不满足（红与连不上必须分开）
 *   会拉起一个 GUI 窗口（真渲染需要），几十秒后自行关闭。本闸不进 npm run check 链。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = Number(process.env.DSH_PET_VERIFY_PORT ?? 9334)
const ENV_OWNER = 'verify'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const PET_EXE = join(DSH_HOME, 'storages', 'cyrene-pet', 'runtime', 'DeepSeek Harness.exe')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cases = []
const eq = (name, got, want, detail = '') => cases.push({ name, ok: got === want, got, want, detail })

function bye (code, why) {
  if (why) console.log(why)
  console.log(`[END] script=check-outline-apply.mjs code=${code}`)
  process.exit(code)
}
function envFail (msg) {
  console.log(`  SKIP ${msg}`)
  console.log('[check-outline-apply] 环境不满足，未判定（红与连不上要分开，不许混）')
  cleanup()
  bye(2)
}
if (!existsSync(PET_EXE)) envFail(`找不到验证实例要用的桌宠 exe：${PET_EXE}`)

/* ---------------- 起验证实例（独立 profile，owner=verify 不会被正式实例认领） ---------------- */
const profile = mkdtempSync(join(tmpdir(), 'dshp-outline-'))
let childPid = null

function killTree (pid) {
  if (pid === null) return
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } catch { /* 杀不掉由下面的复查兜住 */ }
}

function cleanup () {
  killTree(childPid)
  let deleted = false
  for (let i = 0; i < 5; i += 1) {
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* 下一轮再试 */ }
    if (!existsSync(profile)) { deleted = true; break }
    const t = Date.now()
    while (Date.now() - t < 1200) { /* 等句柄释放 */ }
  }
  if (deleted) {
    console.log(`  清理 临时 profile 已删除，复查确认不存在：${profile}`)
    return
  }
  let leftovers = []
  try {
    const walk = (d, base) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const rel = join(base, ent.name)
        if (ent.isDirectory()) walk(join(d, ent.name), rel)
        else leftovers.push(rel)
      }
    }
    walk(profile, '')
  } catch { /* 列不出来也照实报 */ }
  const secrets = leftovers.filter((f) => /vault|key/i.test(f))
  console.log(`  警告 临时 profile 删不掉，需手工处理：${profile}`)
  if (secrets.length > 0) {
    console.log('        其中疑似密钥文件（含敏感内容，别提交、别同步、别进任何备份或推送面）：')
    secrets.slice(0, 6).forEach((f) => console.log(`          ${f}`))
  }
  console.log('        这是本轮探针留下的现场，不是本轮要判定的产品缺陷。')
}

const child = spawn(PET_EXE, [
  '--no-sandbox',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  `--dsh-pet-owner=${ENV_OWNER}`,
], { detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, DSH_PET_HOST: 'plugin' } })
childPid = child.pid
console.log(`验证实例 pid=${childPid} port=${PORT} profile=${profile}`)

const deadline = setTimeout(() => {
  console.log('  SKIP 总超时（实例起不来 / 主窗口没等到 / 描边一直立不起来），判为环境不满足')
  cleanup()
  bye(2)
}, 165000)

/* ---------------- CDP 最小客户端 ---------------- */
async function httpJson (p) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`)
  return r.json()
}
function connect (url) {
  const ws = new WebSocket(url)
  let id = 0
  const waiting = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id)
      waiting.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener('error', () => reject(new Error('ws_error')))
    ws.addEventListener('open', () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id
        waiting.set(mid, { resolve: res, reject: rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      }),
      close: () => { try { ws.close() } catch { /* 已断 */ } },
    }))
  })
}
async function evalJs (c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { __evalErr: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r.result.value
}

/* 等 CDP */
let up = false
for (let i = 0; i < 40; i += 1) {
  try { await httpJson('/json/version'); up = true; break } catch { await sleep(1500) }
}
if (!up) { clearTimeout(deadline); envFail('CDP 端口没起来') }

/* 主界面 target：只要 index.html 那一块，设置窗 / 游戏窗 / 聊天窗都不要 */
let mainT = null
for (let i = 0; i < 25; i += 1) {
  const all = await httpJson('/json/list')
  mainT = all.find((t) => t.type === 'page' && /index\.html/.test(t.url))
  if (mainT) break
  await sleep(1000)
}
if (!mainT) { clearTimeout(deadline); envFail('主界面 target（index.html）没出现，判不了描边') }

const mc = await connect(mainT.webSocketDebuggerUrl)
await mc.send('Runtime.enable')

/* 纪律 1：颜色字面值从产品自己的 OUTLINE_COLORS 拿，不在这里抄一遍 */
const COLORS = await evalJs(mc, `(async () => {
  try {
    const m = await import('./outline.mjs');
    return { ok: true, colors: m.OUTLINE_COLORS, prefer: m.DEFAULT_OUTLINE_PREFERENCE };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
})()`)
if (COLORS?.ok !== true || !COLORS.colors?.dark || !COLORS.colors?.light) {
  clearTimeout(deadline)
  envFail(`读不到产品的 OUTLINE_COLORS（${JSON.stringify(COLORS)}），颜色期望值没有来源，判不了`)
}
const DARK = COLORS.colors.dark
const LIGHT = COLORS.colors.light
console.log(`产品声明的描边色：dark=${DARK} light=${LIGHT} 默认偏好=${COLORS.prefer}`)

const READ = `(async () => {
  const el = document.getElementById('stage');
  if (!el) return { ok: false, err: 'no-#stage' };
  const s = await window.pet.getSettings();
  const st = s && s.presence ? s.presence.outline : undefined;
  return { ok: true, filter: String(el.style.getPropertyValue('filter') || ''),
           outline: typeof st === 'string' ? st : '(未设)',
           media: document.body.innerText.split('\\n').filter(l => /描边|立绘|image|live2d/i.test(l)).slice(0,3) };
})()`

/* 先读初始 */
let init = await evalJs(mc, READ)
if (init?.ok !== true) { clearTimeout(deadline); envFail(`读不到 #stage（${JSON.stringify(init)}）`) }
console.log(`初始  presence.outline=${init.outline}  filter=${init.filter.slice(0, 72) || '(空)'}`)

/* 纪律 2：基线立不起描边就判不了，等它几轮；一直立不起 → code=2，不报红 */
if (init.filter === '') {
  for (let i = 0; i < 8; i += 1) {
    await sleep(2000)
    init = await evalJs(mc, READ)
    if (init.filter !== '') break
  }
}
if (init.filter === '') {
  clearTimeout(deadline)
  console.log(`  现场  立绘行文本：${JSON.stringify(init.media)}`)
  envFail('基线 #stage 上没有任何描边滤镜（验证实例没有可用立绘，或采样一直未成功）。'
    + '「改了设置不跟随」这件事在这种环境下无法判定，报红就是把环境问题算成产品缺陷。')
}
console.log(`  OK  基线描边已立起，可以判「改了跟不跟随」`)

/* 整份存回的产品通道：只换 presence.outline，别的字一个不动。
   saveSettings 的回值形态不作为判据（实测是个对象），落了没有由调用方回读定。 */
async function saveOutline (value) {
  return evalJs(mc, `(async () => {
    const s = await window.pet.getSettings();
    s.presence = Object.assign({}, s.presence, { outline: ${JSON.stringify(value)} });
    await window.pet.saveSettings(s);
    const back = await window.pet.getSettings();
    return { landed: back && back.presence ? back.presence.outline : '(读不到)' };
  })()`)
}
/* 颜色怎么比：产品声明的是 hex（outline.mjs OUTLINE_COLORS），
   Chromium 会把 filter 里的颜色序列化回 rgb(...)，拿 hex 字面去子串匹配必然假红。
   所以两种写法都收，比较前把空白抹平。值本身仍来自产品声明，不在这里抄。 */
const canon = (s) => String(s).replace(/\s+/g, '')
function hexToRgb (hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (m === null) return null
  return `rgb(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)})`
}
const wantsFor = (key) => {
  const hex = key === 'dark' ? DARK : LIGHT
  const rgb = hexToRgb(hex)
  return [hex, rgb].filter(Boolean).map(canon)
}

async function waitFilter (wants, ms) {
  const until = Date.now() + ms
  let last = ''
  while (Date.now() < until) {
    const cur = await evalJs(mc, READ)
    last = cur.filter
    const c = canon(last)
    if (wants.some((w) => c.includes(w))) return { hit: true, filter: last }
    await sleep(1000)
  }
  return { hit: false, filter: last }
}

/* 纪律 3：来回两趟 */
const other = init.outline === 'dark' ? 'light' : 'dark'
const want1 = wantsFor(other)
console.log(`\n第 1 趟  改 presence.outline: ${init.outline} → ${other}，期望 filter 含 ${want1.map((w) => w.replace(/ /g, '')).join(' 或 ')}`)
const s1 = await saveOutline(other)
const r1 = await waitFilter(want1, 14000)
eq(`G1·存值真的落到设置（回读 ${other}）`, true, s1?.landed === other, `回读到 ${s1?.landed}`)
eq(`G2·改成 ${other} 后 #stage filter 立刻跟上`, true, r1.hit,
  `实际 filter=${r1.filter.slice(0, 90) || '(空)'}`)
console.log(`  ${r1.hit ? 'OK ' : 'RED'} 落地值=${s1?.landed}  filter=${r1.filter.slice(0, 72) || '(空)'}`)

const back = init.outline
const want2 = wantsFor(back)
console.log(`\n第 2 趟  改回 ${other} → ${back}，期望 filter 含 ${want2.map((w) => w.replace(/ /g, '')).join(' 或 ')}`)
const s2 = await saveOutline(back)
const r2 = await waitFilter(want2, 14000)
eq(`G3·改回 ${back} 后 #stage filter 立刻跟上`, true, s2?.landed === back && r2.hit,
  `回读 ${s2?.landed} 实际 filter=${r2.filter.slice(0, 90) || '(空)'}`)
console.log(`  ${r2.hit ? 'OK ' : 'RED'}  filter=${r2.filter.slice(0, 72) || '(空)'}`)

/* ---------------- 报告 ---------------- */
clearTimeout(deadline)
let bad = 0
for (const c of cases) {
  console.log(`  ${c.ok ? 'OK ' : 'RED'} ${c.name}${c.detail ? `  （${c.detail}）` : ''}`)
  if (!c.ok) bad += 1
}
console.log(`\n合计 ${cases.length - bad}/${cases.length} 通过`)
mc.close()
cleanup()
bye(bad > 0 ? 1 : 0, bad > 0 ? '\n[check-outline-apply] 描边没在改设置那一刻跟上' : '')
