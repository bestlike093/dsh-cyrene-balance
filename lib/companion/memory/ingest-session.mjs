/**
 * DSH 会话记忆摄取：把一批已批准的候选写进记忆库，并决定游标能不能推进。
 *
 * 为什么从 lib/index.js 里抽出来：
 * 原来这段判断长在 ingestActiveSessionMemory 函数体内，跟模块级单例
 * （state / memoryStore / companionRuntime / persist）缠在一起，没有注入点。
 * 「remember 失败时游标该不该推进」这条不变式因此**无法用常驻断言量到**——
 * 旧结构里 BEFORE 只能是「测不到」，而不是「测出洞」。
 *
 * 抽出来后本文件不 import 任何宿主模块，全部副作用由调用方通过 deps 传入：
 *   remember(item)   → 成功返回结果对象；超时返回 null；失败抛错
 *   upsertFact(item) → 可选，结构化事实；失败不影响原话记忆
 *   onSaved()        → 可选，每成功一条回调一次
 *
 * 游标语义：
 *   advanceCursor 为 true 才允许调用方推进 memoryIngestSession / memoryIngestTotal。
 *   有任意一条没落稳（超时或抛错）就不推，下一轮整轮重来；
 *   调用方用 snapshot() 建的 existing 集合会把已写进去的条目滤掉，重来不会重复堆。
 */

/**
 * @param {Array<object>} approved 本轮被批准写入的候选
 * @param {{ remember: (item: object) => Promise<unknown>, upsertFact?: (item: object) => Promise<unknown>, onSaved?: () => void }} deps
 * @returns {Promise<{ saved: number, failed: number, advanceCursor: boolean }>}
 */
export async function commitApprovedCandidates(approved, deps) {
  const remember = deps?.remember
  if (typeof remember !== 'function') throw new Error('commitApprovedCandidates 需要 remember')
  const upsertFact = typeof deps.upsertFact === 'function' ? deps.upsertFact : null
  const onSaved = typeof deps.onSaved === 'function' ? deps.onSaved : null

  let saved = 0
  let failed = 0
  for (const item of Array.isArray(approved) ? approved : []) {
    try {
      const result = await remember(item)
      /* 存储层没在时限内回应：这条算没落稳，但不挡后面的条目。 */
      if (result === null) {
        failed += 1
        continue
      }
      if (upsertFact !== null) {
        try {
          await upsertFact(item)
        } catch {
          /* 事实写入失败不挡原话记忆 */
        }
      }
      if (onSaved !== null) onSaved()
      saved += 1
    } catch {
      /* 单条记不进去不挡下一条 */
      failed += 1
    }
  }

  /* 游标只在「这一轮一条都没漏」时推进。
   * 有漏的就保持旧值，下一轮整轮重来；调用方用 snapshot() 建的 existing 集合
   * 会把已经写进去的条目滤掉，所以重来不会把同一条堆成两条——重来靠去重兜底，不靠游标。
   *
   * 代价说清楚：如果某一条永远失败，它会每轮都占一个 batch 名额（按置信度排序进 slice）。
   * 这是「静默永久丢失」换成「反复重试并占一位」，两者都不理想；
   * 真正的退避/死信要另一套结构，不在这一格里悄悄扩。 */
  return { saved, failed, advanceCursor: failed === 0 }
}
