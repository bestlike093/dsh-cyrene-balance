/**
 * dsh-cyrene-pet/wechat —— 微信通道 组件行（待拆分）。
 *
 * 拆分蓝图与里程碑见 docs/component-split.md；
 * 通道统一契约见 lib/companion/deliver/channel-contract.mjs。
 * 当前 god apply（lib/index.js）尚未按域搬移，本行默认 disabled；
 * 手动启用会得到下面这条明确提示，而不是静默跑起半套系统。
 */
export const name = 'dsh-cyrene-pet/wechat'
export const inject = ['webServer', 'systemPrompt']

export function apply() {
  throw new Error(
    'dsh-cyrene-pet/wechat（微信通道）尚未从主插件拆分出来（见 docs/component-split.md 里程碑）。' +
    '请保持该组件禁用；完整能力仍由主行提供。',
  )
}
