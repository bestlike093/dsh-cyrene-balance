/**
 * dsh-cyrene-pet/companion —— 陪伴整合 组件行（待拆分）。
 *
 * 拆分蓝图与里程碑见 docs/component-split.md。
 * 当前 god apply（lib/index.js）尚未按域搬移，本行默认 disabled；
 * 手动启用会得到下面这条明确提示，而不是静默跑起半套系统。
 */
export const name = 'dsh-cyrene-pet/companion'
export const inject = ['webServer', 'systemPrompt']

export function apply() {
  throw new Error(
    'dsh-cyrene-pet/companion（陪伴整合）尚未从主插件拆分出来（见 docs/component-split.md 里程碑）。' +
    '请保持该组件禁用；完整能力仍由 pet-kernel 行提供。',
  )
}
