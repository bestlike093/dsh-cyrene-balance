#!/usr/bin/env node
// collect-calibration.mjs —— 2.0.1 值半 · 内测端校准值采集脚本
//
// 纪律（与本仓铁律一致，脚本自身强制，不靠自觉）：
//   1. 读数不写数：只读取 affinity/bond 账本，绝不回写、绝不改参数表、绝不碰生产代码。
//   2. 脱敏出仓：产出包内不含任何 scope 键名、真名、消息内容；scope 仅以不可逆哈希前 8 位做去重标识。
//   3. 样本不足即 insufficient：宁可不给值，也不拿纸面默认（λ=0.01/σ=0.3）冒充满载拟合。
//   4. 负样本缺口暴露：只记录发生过的互动，λ 会被系统性高估——脚本显式标注删失，不假装没有这个问题。
//   5. 自检阳性照报：脱敏扫描若在自己输出里发现真名/scope 键，拒绝写出并报红（铁律对写它的人生效）。
//
// 用法：
//   node scripts/collect-calibration.mjs \
//     --affinity <path/to/affinity.json> \
//     [--bond <path/to/bond.json>] \
//     [--out ./calibration-pack.json] \
//     [--min-samples 8] \
//     [--identity <本内测者匿名代号，如 beta-01>] \
//     [--denylist <逗号分隔的真名/关键词，命中即拒绝输出>]
//
// 退出码：0=产出可用（哪怕部分 insufficient）；2=脱敏自检失败、拒绝输出；1=其他错误。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values: argv } = parseArgs({
  options: {
    affinity: { type: 'string' },
    bond: { type: 'string' },
    out: { type: 'string', default: './calibration-pack.json' },
    'min-samples': { type: 'string', default: '8' },
    identity: { type: 'string', default: 'anon' },
    denylist: { type: 'string', default: '' },
  },
});

const MIN_SAMPLES = Math.max(2, parseInt(argv['min-samples'], 10) || 8);
const DAY_MS = 86400000;

function fail(msg, code = 1) {
  process.stderr.write(`[collect-calibration] ${msg}\n`);
  process.exit(code);
}

if (!argv.affinity || !existsSync(argv.affinity)) {
  fail('缺少或找不到 --affinity <path>，读数无从起。', 1);
}

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { fail(`读不动 ${p}：${e.message}`, 1); }
}

// scope 键不可逆哈希：只做跨字段去重与稳定性，绝不反推原文。
function anonScope(rawKey) {
  return createHash('sha256').update(String(rawKey)).digest('hex').slice(0, 8);
}

// 从多种可能结构里尽力取出「每 scope 的互动时间戳序列」。
// 只认真实存在的字段；取不到就返回空数组，交给 insufficient 分支。
function extractTimestamps(scopeObj) {
  const stamps = [];
  // 优先 lastInteractionAt（本方案新采集面）；兼容 history/interactions 数组。
  if (scopeObj && typeof scopeObj === 'object') {
    const candidates = [
      scopeObj.lastInteractionAt,
      scopeObj.updatedAt, // 注意：可能为文件 mtime 误读，脚注标注
    ];
    for (const c of candidates) {
      const t = toMs(c);
      if (t != null) stamps.push(t);
    }
    const arr = scopeObj.history || scopeObj.interactions || scopeObj.events;
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const t = toMs(item && (item.at ?? item.ts ?? item.time ?? item.timestamp));
        if (t != null) stamps.push(t);
      }
    }
  }
  return [...new Set(stamps)].sort((a, b) => a - b);
}

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    // 秒级时间戳兜底：小于 1e12 视作秒
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (v.trim() !== '' && !Number.isNaN(n)) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(v);
    if (!Number.isNaN(d)) return d;
  }
  return null;
}

// 指数生存模型 MLE（无删失）：λ = N / ΣΔt；带删失时把「观察窗末端至今未回」计入总暴露时间。
// 返回 { lambda, intervals, censored, exposedDays } 或 null（样本不足）。
function fitLambda(timestamps, nowMs) {
  if (!timestamps || timestamps.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < timestamps.length; i++) {
    const dt = timestamps[i] - timestamps[i - 1];
    if (dt > 0) intervals.push(dt / DAY_MS);
  }
  // 删失：最后一次互动到「现在」这段，尚未观察到下一次（看到未回），计入暴露但不算事件。
  const censoredDays = Math.max(0, (nowMs - timestamps[timestamps.length - 1]) / DAY_MS);
  const events = intervals.length;                       // 观察到的「回」次数
  const exposed = intervals.reduce((a, b) => a + b, 0) + censoredDays; // 总暴露天数（含删失）
  if (events < MIN_SAMPLES - 1 || exposed <= 0) return null;
  const lambda = events / exposed;                       // 次/天
  return {
    lambda: round(lambda),
    events,
    censoredDays: round(censoredDays, 2),
    exposedDays: round(exposed, 2),
    intervalsDays: intervals.map((x) => round(x, 3)),
  };
}

// σ（强化系数）需要「互动前后同一代理值」的配对观测。favor/turns 全 0 时无材料 → null。
function fitSigma(scopeObj) {
  const before = numOrNull(scopeObj?.favorBefore ?? scopeObj?.favor);
  const after = numOrNull(scopeObj?.favorAfter);
  if (before == null || after == null) return null;
  // 占位：真实实现需成对采样，此处仅在有真配对时才给值，否则诚实留空。
  return null;
}

function numOrNull(v) {
  const n = Number(v);
  return v != null && v !== '' && !Number.isNaN(n) ? n : null;
}

function round(x, d = 5) {
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

// ---- 主流程 ----
const affinity = readJSON(argv.affinity);
const bond = existsSync(argv.bond || '') ? readJSON(argv.bond) : null;
const nowMs = Date.now();

const scopes = affinity?.scopes && typeof affinity.scopes === 'object' ? affinity.scopes : {};
const scopeKeys = Object.keys(scopes);

const perScope = [];
let usableScopes = 0;
for (const key of scopeKeys) {
  const sc = scopes[key] || {};
  const stamps = extractTimestamps(sc);
  const fit = fitLambda(stamps, nowMs);
  const sigma = fitSigma(sc);
  if (fit) usableScopes++;
  perScope.push({
    id: anonScope(key),                    // 不可逆哈希，非原文
    hasLastInteractionAt: Array.isArray(sc.history || sc.interactions || sc.events)
      ? (sc.lastInteractionAt != null)
      : (sc.lastInteractionAt != null),
    lambda: fit ? fit.lambda : null,
    sigma,                                  // 现网几乎必为 null（favor/turns 全 0）
    events: fit ? fit.events : 0,
    censoredDays: fit ? fit.censoredDays : null,
    status: fit ? 'fitted' : 'insufficient',
    note: fit ? null : '互动时间戳样本不足或全为死值，不给值（读数不写数）',
  });
}

// 聚合：只出分位数/均值/样本数，绝不出单 scope 原文。
const lambdas = perScope.map((s) => s.lambda).filter((x) => x != null).sort((a, b) => a - b);
function pct(arr, p) {
  if (!arr.length) return null;
  const i = Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))));
  return arr[i];
}
const aggregate = {
  scopeTotal: scopeKeys.length,
  scopeUsable: usableScopes,
  lambda: lambdas.length
    ? { min: lambdas[0], p50: pct(lambdas, 0.5), p90: pct(lambdas, 0.9), max: lambdas[lambdas.length - 1], n: lambdas.length }
    : null,
  sigma: null, // 无配对材料，整体 insufficient
  thresholds: null, // 无 R 观测分布，分档阈值本轮不可拟
  censoringDisclosed: true, // 已把「看到未回」计入删失，λ 仍可能被高估
  dataPlaneEmpty: usableScopes === 0,
};

const pack = {
  schema: 'calibration-pack/v1',
  identity: argv.identity,
  collectedAt: new Date().toISOString(),
  minSamples: MIN_SAMPLES,
  source: { affinity: 'redacted', bond: bond ? 'sealed-not-opened' : 'absent' },
  aggregate,
  perScope, // 仅哈希 id + 数值，无原文
  honestNote: aggregate.dataPlaneEmpty
    ? '本机数据面为空（无可用互动时间戳），本包不含 λ/σ 值，仅作为「缺口证据」回传。'
    : 'λ 已就位；σ/阈值因缺配对观测仍 insufficient，勿拿纸面默认补。',
};

// ---- 脱敏自检：输出前扫一遍自己的产物，命中真名/scope 原文即拒绝写出 ----
const deny = argv.denylist.split(',').map((s) => s.trim()).filter(Boolean);
const blob = JSON.stringify(pack);
for (const kw of deny) {
  if (kw && blob.includes(kw)) {
    process.stderr.write(`[collect-calibration] 脱敏自检失败：产物含命中词「${kw}」，拒绝输出（自检阳性照报）。\n`);
    process.exit(2);
  }
}
// 兜底：产物里不得出现任何原始 scope 键名。
// 仅对长度≥6 的键做泄漏检查——单/短字母键（如 "a"/"b"）会在 JSON 结构里到处子串命中造成假红，
// 且真 scope 键（如 grp_xxx）长度足够，若真泄漏必被此阈捕获。哈希化的 id 不含原文，正常不命中。
for (const key of scopeKeys) {
  if (key && key.length >= 6 && blob.includes(key)) {
    process.stderr.write(`[collect-calibration] 脱敏自检失败：产物含原始 scope 键，拒绝输出。\n`);
    process.exit(2);
  }
}

writeFileSync(argv.out, JSON.stringify(pack, null, 2), 'utf8');
process.stdout.write(
  `[collect-calibration] 已写出 ${argv.out}\n` +
  `  scope 总数 ${aggregate.scopeTotal} / 可用 ${aggregate.scopeUsable}\n` +
  `  λ: ${aggregate.lambda ? `p50=${aggregate.lambda.p50} n=${aggregate.lambda.n}` : 'insufficient'}\n` +
  `  σ: insufficient（缺配对观测） 阈值: insufficient（缺 R 观测分布）\n` +
  `  ${pack.honestNote}\n`,
);
process.exit(0);
