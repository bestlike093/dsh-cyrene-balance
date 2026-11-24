#!/usr/bin/env node
/**
 * check-p1-socket.mjs —— P1 插座闸（实施单 §2-P1a 的验收断言载体）
 *
 * 守五件事：
 *  S1 参数表标注齐全：每个可推移字段四件套（base/boundary/rateCap/status），status 全 manual；
 *  S2 艾宾浩斯 fixture：时间推进 R 单调降、强化抬回、间隔效应、三分档边界（实施单验收⑤）；
 *  S3 无硬编码：retention.mjs 剥注释剥字符串后不得出现可调小数值（参数只准进参数表）；
 *  S4 契约校验有牙：合规绿 + 三款红样本必红（先证红制度化：基线红、现网绿双证）；
 *  S5 零接线：三个新插座文件在生产面消费者 == 0（本版只立插座，行为必 unchanged）。
 *
 * 用法：node scripts/check-p1-socket.mjs
 * 退出码：0 全绿 / 1 任一红。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE = path.join(ROOT, 'lib', 'companion', 'state')
const results = []
const put = (name, ok, got) => results.push({ name, ok, got: String(got ?? '') })

const { REFLECTION_PARAMS } = await import(pathToFileURL(path.join(STATE, 'reflection-params.mjs')).href)
const { decayR, reinforceR, classifyBand } = await import(pathToFileURL(path.join(STATE, 'retention.mjs')).href)
const { STAGE_CONTRACT, validateStageOutput } = await import(pathToFileURL(path.join(STATE, 'stage-contract.mjs')).href)
const { RELATION } = await import(pathToFileURL(path.join(ROOT, 'lib', 'companion', 'standard.mjs')).href)

// ---- S1 参数表标注齐全 ----
{
  const groups = [
    ['stageScoreThresholds', REFLECTION_PARAMS.stageScoreThresholds],
    ['stageDayThresholds', REFLECTION_PARAMS.stageDayThresholds],
  ]
  let bad = []
  for (const [gname, arr] of groups) {
    for (const f of arr) {
      if (!Number.isFinite(f.base) || !Array.isArray(f.boundary) || !Number.isFinite(f.rateCapPerInteraction)
        || f.status !== 'manual' || f.reflectionEnabled !== false || f.trace !== 'sealed') bad.push(`${gname}.${f.path}`)
    }
  }
  const single = [REFLECTION_PARAMS.hysteresis, ...Object.values(REFLECTION_PARAMS.retention)]
  for (const f of single) {
    if (!Array.isArray(f.boundary) || !Number.isFinite(f.rateCapPerInteraction ?? f.base) || f.status !== 'manual'
      || f.reflectionEnabled !== false || f.trace !== 'sealed') bad.push(f.path)
  }
  put('S1a 每字段四件套齐全且标 manual/未启用', bad.length === 0, bad.length ? '缺标: ' + bad.join(',') : `覆盖 ${REFLECTION_PARAMS.stageScoreThresholds.length}+${REFLECTION_PARAMS.stageDayThresholds.length}+${single.length} 字段`)
  // 覆盖对账：thresholds 条数 == RELATION 可推移档数
  const expectScore = RELATION.stages.filter((s) => Number.isFinite(s.scoreMin)).length
  const expectDay = RELATION.stages.filter((s) => s.daysMin > 0).length
  put('S1b 覆盖对账：标注档数==standard 可推移档数',
    REFLECTION_PARAMS.stageScoreThresholds.length === expectScore && REFLECTION_PARAMS.stageDayThresholds.length === expectDay,
    `标注 ${REFLECTION_PARAMS.stageScoreThresholds.length}/${expectScore} 分数、${REFLECTION_PARAMS.stageDayThresholds.length}/${expectDay} 天数`)
  // base 与 standard 同值不漂移
  const drift = REFLECTION_PARAMS.stageScoreThresholds.filter((f) => {
    const key = f.path.split('.')[2]
    const s = RELATION.stages.find((x) => x.key === key)
    return !s || s.scoreMin !== f.base
  })
  put('S1c base 与 standard 同源未漂移', drift.length === 0, drift.length ? drift.map((d) => d.path).join(',') : '逐档相等')
}

// ---- S2 艾宾浩斯 fixture ----
{
  const DAY = 86400000
  const lam = REFLECTION_PARAMS.retention.lambdaPerDay.base
  const t0 = Date.UTC(2026, 10, 24)
  const r7 = decayR({ lastAtMs: t0, nowMs: t0 + 7 * DAY, lambdaPerDay: lam })
  const r30 = decayR({ lastAtMs: t0, nowMs: t0 + 30 * DAY, lambdaPerDay: lam })
  const r0 = decayR({ lastAtMs: t0, nowMs: t0, lambdaPerDay: lam })
  put('S2a 单调降：R(0d)>R(7d)>R(30d)，R(0)==1', r0 === 1 && r7 > r30 && r0 > r7, `r0=${r0} r7=${r7.toFixed(4)} r30=${r30.toFixed(4)}`)
  const up = reinforceR({ r: r30, gapDays: 0, lambdaPerDay: lam, sigma: REFLECTION_PARAMS.retention.sigma.base })
  put('S2b 强化抬回：互动一次 R 升', up > r30, `${r30.toFixed(4)}→${up.toFixed(4)}`)
  const near = reinforceR({ r: 0.2, gapDays: 1, lambdaPerDay: lam, sigma: REFLECTION_PARAMS.retention.sigma.base })
  const far = reinforceR({ r: 0.2, gapDays: 200, lambdaPerDay: lam, sigma: REFLECTION_PARAMS.retention.sigma.base })
  put('S2c 间隔效应：久隔重逢抬得少', near > far, `near=${(near - 0.2).toFixed(4)} far=${(far - 0.2).toFixed(4)}`)
  const light = REFLECTION_PARAMS.retention.lightThreshold.base
  const pin = REFLECTION_PARAMS.retention.pinThreshold.base
  const b1 = classifyBand({ r: light - 0.01, lightThreshold: light, pinThreshold: pin })
  const b2 = classifyBand({ r: (light + pin) / 2, lightThreshold: light, pinThreshold: pin })
  const b3 = classifyBand({ r: pin + 0.01, lightThreshold: light, pinThreshold: pin })
  put('S2d 三分档边界正确', b1 === 'light' && b2 === 'long' && b3 === 'pinned', `${b1}/${b2}/${b3}`)
  const cap = reinforceR({ r: 0.99, gapDays: 0, lambdaPerDay: lam, sigma: REFLECTION_PARAMS.retention.sigma.base })
  put('S2e 封顶 1 不破', cap <= 1, String(cap))
}

// ---- S3 无硬编码（retention.mjs 剥注释剥字符串）----
{
  let src = fs.readFileSync(path.join(STATE, 'retention.mjs'), 'utf8')
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  src = src.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
  const nums = src.match(/\d+\.\d+/g) || []
  const bigInts = (src.match(/\b\d{2,}\b/g) || []).filter((n) => n !== '86400000' || true)
  put('S3 retention.mjs 无可调数值硬编码', nums.length === 0 && bigInts.length === 0,
    (nums.length || bigInts.length) ? `发现: ${[...nums, ...bigInts].join(',')}` : '小数 0 处、多位整数 0 处')
}

// ---- S4 契约校验有牙：绿样本 + 三款红样本 ----
{
  const good = { stageKey: 'familiar', source: 'auto', confidence: 0.7, traceId: 't-x-1' }
  put('S4a 合规输出绿', validateStageOutput(good).ok === true, JSON.stringify(validateStageOutput(good)))
  const red1 = validateStageOutput({ stageKey: 'familiar', source: 'auto', confidence: 0.5 })
  const red2 = validateStageOutput({ stageKey: 'transcendent', source: 'auto', confidence: 0.5, traceId: 't' })
  const red3 = validateStageOutput({ stageKey: 'familiar', source: 'both', confidence: 1.5, traceId: 't' })
  put('S4b 基线红①缺 traceId 必报', !red1.ok && red1.violations.some((v) => v.includes('traceId')), red1.violations.join('|'))
  put('S4c 基线红②越档位表必报', !red2.ok && red2.violations.some((v) => v.includes('档位')), red2.violations.join('|'))
  put('S4d 基线红③source 双值/confidence 越界必报', !red3.ok && red3.violations.length >= 2, red3.violations.join('|'))
  put('S4e 契约声明完好：来源只 auto/override、输入只读',
    STAGE_CONTRACT.output.sources.join(',') === 'auto,override' && STAGE_CONTRACT.input.access === 'readOnly',
    STAGE_CONTRACT.contractId)
}

// ---- S5 零接线：生产面无消费者 ----
{
  const socketNames = ['retention.mjs', 'reflection-params.mjs']
  // stage-contract.mjs 已于刀④毕业（bond 生产接线，check-contract-wire 验收其形状）；
  // 零接线名单只留仍未接线的插座——「毕业」与「未接线」必须分开，名单不许赖着不更新
  const hits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'pack-out') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(mjs|js|cjs)$/.test(e.name)) continue
      const rel = path.relative(ROOT, p).replace(/\\/g, '/')
      if (rel.startsWith('lib/companion/state/') && socketNames.some((n) => rel.endsWith(n))) continue
      if (rel.startsWith('scripts/') || rel.startsWith('test/') || rel.startsWith('docs/')) continue
      const src = fs.readFileSync(p, 'utf8')
      // 消费者=import 接线；注释/文档提及不算（salience 头注提过兄弟文件名曾误报）
      for (const n of socketNames) {
        const re = new RegExp(`from\\s+['"][^'"]*${n.replace('.', '\\.')}['"]`)
        if (re.test(src)) hits.push(rel + '→' + n)
      }
    }
  }
  walk(ROOT)
  put('S5 生产面消费者==0（插座未接线，行为 unchanged）', hits.length === 0, hits.length ? hits.join(', ') : 'lib/pet 生产树零引用')
}

let fail = 0
for (const r of results) {
  if (!r.ok) fail += 1
  console.log(`  ${r.ok ? 'OK ' : 'RED'} ${r.name}  → ${r.got.slice(0, 120)}`)
}
console.log(`[check-p1-socket] 共 ${results.length} 条，红 ${fail} 条`)
console.log(`[END] script=check-p1-socket code=${fail ? 1 : 0}`)
process.exit(fail ? 1 : 0)
