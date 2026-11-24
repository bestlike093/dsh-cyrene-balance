/*
 * check-peer-map.mjs —— P0 归并权威表闸（首版：schema + fixture 双头基线 + live 载体位）
 *
 * 归并律（唯一一条，写死）：人卡档位/好感只读 affinity[primaryScope]；
 * 无 primaryScope 可立 → 初识名单，不上人卡、不猜（主人裁定 §8.48 铁三）。
 *
 * 断言：
 *   M1 基线有牙：fixture 无 map 态，出卡器必须报 DIVERGENT（跨 scope 同人两张卡档位互斥）。
 *   M2 基线转绿：fixture 有 map 态，peers[0] 恰好一张人卡且 favor==affinity[primaryScope]；
 *      peers[1]（primaryScope=null）必须落在初识名单、绝不在人卡。
 *   M3 live 载体：现网 STATE_DIR 的 peer-map.json 在位且合 schema——当下必红（表未建，P0 数据层
 *      落地后转绿）。这一条是 A1 结构红的闸化。
 *   M4 schema 边界：carrier 存在时校验字段（peerId/primaryScope/memberScopes/establishedAt/source）；
 *      carrier 缺席时 SKIP 不假绿。
 *
 * fixture 是探针的靶：现网真分歧样本=0（密文未开），本闸绿 ≠ 现实已验，账 §8.48 已注。
 * 用法：node scripts/check-peer-map.mjs   code=0 全绿 / 1 有红
 */
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIX = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/peer-map-baseline.json'), 'utf8'))

/** 出卡器（归并律实现）：map=null 时按 scope 出卡=场所当人态。 */
function personCards(affinity, peers, map) {
  const cards = []
  const roster = []
  if (map === null) {
    // 无 map：每个 scope 各出一张卡（现状行为）——同人多 scope 时档位互斥 = DIVERGENT
    const byPeer = new Map()
    for (const p of peers) byPeer.set(p.peerId, p.appearsIn)
    for (const [pid, scopes] of byPeer) {
      const favors = scopes.map((s) => (affinity[s] || {}).favor)
      const divergent = favors.length >= 2 && Math.max(...favors) - Math.min(...favors) >= 20
      if (divergent) cards.push({ peerId: pid, status: 'DIVERGENT', via: scopes })
    }
    return { cards, roster }
  }
  for (const p of peers) {
    const primary = map[p.peerId]
    if (primary === null || primary === undefined) { roster.push(p.peerId); continue }
    if (!existsScope(affinity, primary)) { roster.push(p.peerId); continue }
    cards.push({ peerId: p.peerId, status: 'MERGED', favor: affinity[primary].favor, via: primary })
  }
  return { cards, roster }
}
function existsScope(affinity, scope) {
  return affinity[scope] !== undefined && affinity[scope] !== null
}

const results = []

// M1 无 map 必红
const noMap = personCards(FIX.affinity, FIX.peers, null)
const m1 = noMap.cards.some((c) => c.status === 'DIVERGENT' && c.peerId === FIX.peers[0].peerId)
results.push([m1, 'M1·基线有牙：无 map 时同人跨 scope 必报 DIVERGENT', m1 ? '' : `出卡器在无 map 态没抓到分歧（cards=${JSON.stringify(noMap.cards)}），断言无牙`])

// M2 有 map 转绿 + 初识名单
const map = {}
for (const p of FIX.peers) map[p.peerId] = p.primaryScope
const withMap = personCards(FIX.affinity, FIX.peers, map)
const merged = withMap.cards.filter((c) => c.status === 'MERGED')
const m2a = merged.length === 1 && merged[0].peerId === FIX.peers[0].peerId
  && merged[0].favor === FIX.affinity[FIX.peers[0].primaryScope].favor
const m2b = withMap.roster.includes(FIX.peers[1].peerId)
  && !withMap.cards.some((c) => c.peerId === FIX.peers[1].peerId)
results.push([m2a, 'M2a·有 map 态：peers[0] 恰一张人卡、值==affinity[primaryScope]', m2a ? '' : JSON.stringify(merged)])
results.push([m2b, 'M2b·建不起映射进初识名单、不上人卡（不猜）', m2b ? '' : `roster=${JSON.stringify(withMap.roster)} cards=${JSON.stringify(merged.map((c) => c.peerId))}`])

// M3 live 载体（当下该红：表未建）
const STATE = join(homedir(), '.dsh', 'storages', 'cyrene-pet')
const carrier = join(STATE, 'peer-map.json')
const carrierInPlace = existsSync(carrier)
results.push([carrierInPlace, 'M3·live 载体 peer-map.json 在位',
  carrierInPlace ? '在位（转 M4 校验）' : '现网无 peer-map.json——归并权威源未建，P0 数据层落地后此条转绿（当下该红，A1 闸化）'])

// M5 钉一·全表面可写入口 == 1：扫两仓源码，出现「peer-map 落盘动作」的文件必须恰是桌宠的 affinity.mjs
const SCRUTINIZED = [
  'pet/standalone/apps/desktop/electron',
  'lib',
  '../../projects/desktop-pet/apps/desktop/electron'
]
const writers = []
const missingDirs = []
for (const dir of SCRUTINIZED) {
  const abs = join(ROOT, dir)
  let names = []
  try { names = readdirSync(abs) } catch { missingDirs.push(dir); continue }
  for (const name of names) {
    if (!/\.(js|mjs)$/.test(name)) continue
    const body = '' // 占位防 lint
    void body
    try {
      const src = readFileSync(join(abs, name), 'utf8')
      const writesDisk = /peer-map/.test(src) && /(writeFile|rename|appendFile|copyFile)\s*\([^)]*peerMap|persistPeerMap|peer-map\.json['"`]\s*\)|writeFile\([^)]*['"`][^'"`]*peer-map/.test(src)
      const directWrite = /writeFile\([^)]*peer-map/.test(src) || /fs\.writeFile\([^)]*peer-?map/i.test(src)
      if (writesDisk || directWrite) writers.push(`${dir}/${name}`)
    } catch { /* 目录项非文件 */ }
  }
}
results.push([missingDirs.length === 0 && writers.length === 1
  && writers[0].endsWith('affinity.mjs') && writers[0].startsWith('pet/standalone'),
  'M5·钉一：全表面 peer-map 可写入口恰 1 且是桌宠 affinity.mjs',
  missingDirs.length > 0 ? `扫描面缺目录：${missingDirs.join(', ')}——面不全不算绿`
    : writers.length === 0 ? '还没有任何写侧——生成通道未落，该红（本刀要点的红基线）' : writers.join(', ')])

// M6 钉二·写侧派生行为探针（临时目录，不碰现网）：私聊 scope → flush 后 peer-map 应成行且律唯一
try {
  const { createAffinity } = await import(pathToFileURL(join(ROOT, 'pet/standalone/apps/desktop/electron/affinity.mjs')).href)
  const tmp = mkdtempSync(join(tmpdir(), 'peermap-probe-'))
  const affFile = join(tmp, 'affinity.json')
  const aff = createAffinity({ file: affFile, now: () => 1700000000000 })
  await aff.ready()
  aff.recordTurn('在吗', '在呀', 'qq:private:PROBEPEER0001')
  aff.recordTurn('群里的话', '收到', 'qq:group:PROBEGROUP0002')
  await aff.flush()
  const mapPath = join(tmp, 'peer-map.json')
  if (existsSync(mapPath)) {
    const pm = JSON.parse(readFileSync(mapPath, 'utf8'))
    const e = (pm.entries || []).find((x) => x.peerId === 'PROBEPEER0001')
    const groupLeaked = (pm.entries || []).some((x) => String(x.primaryScope).startsWith('qq:group'))
    const ok = Boolean(e) && e.primaryScope === 'qq:private:PROBEPEER0001'
      && Number(e.establishedAt) === 1700000000000 && e.source === 'affinity-private' && !groupLeaked
      && Array.isArray(pm.rejected)
    results.push([ok, 'M6·钉二：写侧派生只认私聊、群不落 map、字段合界',
      ok ? '探针绿' : `entries=${JSON.stringify(pm.entries)} rejected=${JSON.stringify(pm.rejected || '缺')}`])
  } else {
    results.push([false, 'M6·钉二：写侧派生只认私聊、群不落 map、字段合界',
      'flush 后无 peer-map.json——生成通道未落，该红（本刀红基线）'])
  }
  rmSync(tmp, { recursive: true, force: true })
} catch (error) {
  results.push([false, 'M6·钉二：写侧派生探针', '探针跑不起来：' + error.message])
}

// M7 钉三·三态出卡断言（行为三牙 + 结构接线位）——先证红：模块未建、渲染未改时必红
const favorsOf = Object.fromEntries(Object.entries(FIX.affinity).map(([k, v]) => [k, v.favor]))
const mapDoc = { entries: FIX.peers.filter((p) => p.primaryScope).map((p) => ({ peerId: p.peerId, primaryScope: p.primaryScope })) }
let peerCards = null
try {
  peerCards = await import(pathToFileURL(join(ROOT, 'pet/standalone/apps/desktop/electron/peer-cards.mjs')).href)
} catch (error) {
  results.push([false, 'M7·钉三：三态出卡器（NO_MAP/有映射/无映射）', 'peer-cards.mjs 不存在或加载失败——出卡权威层未建，该红（红基线）：' + error.message])
}
if (peerCards && typeof peerCards.buildPeerCards === 'function') {
  const absent = peerCards.buildPeerCards(favorsOf, null)
  const t1 = absent.state === 'NO_MAP' && absent.personCards.length === 0
    && absent.roster.includes(FIX.peers[0].peerId)
    && !JSON.stringify(absent.personCards).includes('scope') // 回落形态：personCards 里不许出现任何按 scope 出的卡
  const ok = peerCards.buildPeerCards(favorsOf, mapDoc)
  const t2 = ok.state === 'OK' && ok.personCards.length === 1
    && ok.personCards[0].scope === FIX.peers[0].primaryScope
    && ok.personCards[0].favor === FIX.affinity[FIX.peers[0].primaryScope].favor
  // 中间态·诚实输入版（2026-11-24 证红轮逮出原期望是要求出卡器预知密文面的仅群人，改此形态）：
  // 私聊 scope 在账本里、entries 无对应行 → 名单。仅群人群的上屏归 P1 人网格格，本格不假装覆盖。
  const ghost = peerCards.buildPeerCards({ 'qq:private:GHOSTPEER001': 30 }, { entries: [] })
  const t3 = ghost.state === 'OK' && ghost.roster.includes('GHOSTPEER001') && ghost.personCards.length === 0
  results.push([t1, 'M7a·反半（最重）：map 缺席 state=NO_MAP，人卡空、无 scope 回落形态', t1 ? '' : JSON.stringify(absent)])
  results.push([t2, 'M7b·正半：出卡键==primaryScope、值取主 scope 那份（非群值）', t2 ? '' : JSON.stringify(ok.personCards)])
  results.push([t3, 'M7c·中间态：有私聊账、无映射行 → 进名单不上人卡', t3 ? '' : JSON.stringify(ghost)])
}
// M7d 接线位独立于行为守卫：模块在不在都要扫渲染面，静默跳过=扫描面的洞
{
  const insRenderer = readFileSync(join(ROOT, 'pet/standalone/apps/desktop/electron/renderer/insight.js'), 'utf8').replace(/\r/g, '')
  const wired = /peerCards/.test(insRenderer) && /NO_MAP/.test(insRenderer)
  results.push([wired, 'M7d·接线位：renderBonds 消费 snapshot.peerCards 且有 NO_MAP 显式分支',
    wired ? '' : '渲染层还按 session.scope 出卡、没接 peerCards——静默回落在场，该红（红基线）'])
}

// M4 schema 边界
if (carrierInPlace) {
  try {
    const cm = JSON.parse(readFileSync(carrier, 'utf8'))
    const rows = Array.isArray(cm.entries) ? cm.entries : []
    const bad = rows.filter((r) => !r.peerId || !('primaryScope' in r) || !Array.isArray(r.memberScopes) || !r.establishedAt || !r.source)
    const dup = rows.length - new Set(rows.map((r) => r.peerId)).size
    results.push([bad.length === 0 && dup === 0, 'M4·carrier schema 合界 + peerId 唯一',
      bad.length === 0 && dup === 0 ? `entries=${rows.length}` : `坏行 ${bad.length}，重复 peerId ${dup}`])
  } catch (e) {
    results.push([false, 'M4·carrier schema 合界 + peerId 唯一', 'carrier 读不出 JSON：' + e.message])
  }
} else {
  results.push([true, 'M4·carrier schema 合界（SKIP：载体未建不假绿）', ''])
}

let bad = 0
for (const [pass, name, note] of results) {
  console.log(`  ${pass ? 'OK ' : 'RED'} ${name}${pass ? '' : '  ' + note}`)
  if (!pass) bad += 1
}
console.log(`[check-peer-map] 红 ${bad} 条（M3 当下该红属预期：表未建）`)
console.log(`[END] script=check-peer-map.mjs code=${bad === 0 ? 0 : 1}`)
process.exit(bad === 0 ? 0 : 1)
