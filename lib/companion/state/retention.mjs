/**
 * retention.mjs —— 艾宾浩斯留存纯函数（P1 插座 · 实施单§2-P1 步4）
 *
 * 抄机制不抄装的来源：SAGE/Molili 用遗忘曲线做记忆优化（蓝本 v4 §9 第三路）。
 * 实施单口径：留存 R=e^(−λ·t)；强化按间隔效应（及时互动续命强、久远互动贡献微弱）；
 * 分档 R<light 放轻、light–pin 长期、>pin 钉住。
 *
 * 纪律：**本文件不写任何可调数值**——λ、σ、阈值全部由调用方从
 * reflection-params 参数表注入；代码里出现小数硬编码，check-p1-socket S3 直接报红。
 * 纯函数：不读文件、不碰宿主、时间由调用方注入（relationship-stage 同款口径）。
 */
import { TIME } from '../standard.mjs'

/**
 * 单次留存：R = e^(−λ·t)，t 为距上次互动的天数。
 * @param {{lastAtMs:number, nowMs:number, lambdaPerDay:number}} p
 * @returns {number} R ∈ (0,1]
 */
export function decayR({ lastAtMs, nowMs, lambdaPerDay }) {
  const tDays = (nowMs - lastAtMs) / TIME.DAY
  if (!(tDays >= 0)) return 1
  return Math.exp(-lambdaPerDay * tDays)
}

/**
 * 互动后强化（间隔效应）：lift = σ·(1−R)·e^(−λ·gapDays)。
 * 距离上次互动越久，这次互动的续命力度越大里子有两层：
 * 剩余空间 (1−R) 大所以抬得多，间隔因子单独表达「久远互动贡献微弱」——
 * 按实施单口径，间隔项取 e^(−λ·gap) 让久隔重逢的抬升按 λ 衰减记入（语义工随参数表校准）。
 * @param {{r:number, gapDays:number, lambdaPerDay:number, sigma:number}} p
 * @returns {number} 强化后的 R，封顶 1
 */
export function reinforceR({ r, gapDays, lambdaPerDay, sigma }) {
  const headroom = 1 - r
  const intervalFactor = Math.exp(-lambdaPerDay * gapDays)
  const next = r + sigma * headroom * intervalFactor
  return next > 1 ? 1 : next
}

/**
 * 三分档：light / long / pinned。阈值注入，不写死。
 * @param {{r:number, lightThreshold:number, pinThreshold:number}} p
 * @returns {'light'|'long'|'pinned'}
 */
export function classifyBand({ r, lightThreshold, pinThreshold }) {
  if (r < lightThreshold) return 'light'
  if (r > pinThreshold) return 'pinned'
  return 'long'
}
