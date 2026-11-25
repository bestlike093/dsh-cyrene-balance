/**
 * 主人自由发言要不要接话（B2-011）。
 *
 * 为什么单独成一个文件：这段判断原来长在 qq-host.mjs 的 start() 里、
 * webhook 回调闭包内部（:132-136），要触发它就得把通道起起来。
 * 判据因此连落点都没有——测不出来，不等于测过。
 * 抽成纯函数后这里零宿主依赖，行为不变式可以直接量。
 *
 * 与 group-reply-gate.mjs 各管一件事，别混：
 * 那个管「被 @ 之后限不限流」，这个管「未 @ 的话该不该接」。
 *
 * atMe 是三态，不是布尔：
 *   - true / false 由上游明确给出；
 *   - null（含字段缺失）代表「不知道」—— GROUP_AT_MESSAGE_CREATE 这条路径
 *     parseOfficialEvent 压根不写 atMe，透传下来就是 null。
 * 所以「没被 @」只能认 atMe === false，写 !== true 会把被 @ 的群消息一起挡掉，
 * 那是修一个洞开一个洞。
 */

/**
 * @param {{ reason?: string, kind?: string, atMe?: boolean | null, content?: string }} input
 * @returns {boolean} 该不该把这条交给 onChat
 */
export function shouldReplyToOwnerMessage(input = {}) {
  /* 网关没判成主人自由发言，本来就不接。 */
  if (input.reason !== 'owner-message') return false
  /* 空正文（只有图片标记之类）交给上层自己决定，这里不接。 */
  if (String(input.content ?? '').trim() === '') return false
  /*
   * B2-011：群内明确未被 @ 的主人消息只进记忆、不接话。
   * 两个条件都得站着：
   *   kind === 'group' —— 私聊不该被群规则碰；上游万一给 c2c 错标了 false，
   *                       主人的私聊照样要接（判据里有这条）。
   *   atMe === false   —— 只认「明确未被 @」。null / undefined 是被 @ 那条路径
   *                       透传下来的「不知道」，写成 !== true 会把它们一起挡掉。
   */
  if (input.kind === 'group' && input.atMe === false) return false
  return true
}
