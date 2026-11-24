/**
 * 背景槽位的单一事实源：桌宠 5 槽与 DSH 4 槽的口径和映射。
 *
 * 两端（桌宠 main.mjs / DSH index.js）都从这里 import，改槽位只动这一处。
 *
 * 桌宠侧 5 槽（settings.json 的 background.slots，主进程渲染各自读取）：
 *   petChat     桌宠聊天窗
 *   petSettings 桌宠设置页
 *   petPanels   桌宠独立页面（背景库 / 会话 / 表情库）
 *   dshPage     DSH 页面
 *   dshCard     DSH 设置卡片
 *
 * DSH 侧 4 槽（state.background.slots，页面与设置卡片各选各的）：
 *   page          DSH 页面          ← dshPage
 *   window        桌宠独立窗口      ← petPanels
 *   settingsCard  DSH 设置卡片     ← dshCard
 *   settingsWindow 桌宠设置窗      ← petSettings
 *
 * petChat 只在桌宠内部用，DSH 不读。
 */

/** 桌宠 settings.json 里落盘的五个槽。 */
export const PET_BACKGROUND_SLOT_KEYS = Object.freeze([
  'petChat',
  'petSettings',
  'petPanels',
  'dshPage',
  'dshCard',
])

/** DSH 自己的四个位置。 */
export const DSH_BACKGROUND_SLOT_NAMES = Object.freeze([
  'page',
  'window',
  'settingsCard',
  'settingsWindow',
])

/** DSH 槽名 → 桌宠槽名：DSH 没设的位置回落到桌宠设置里对应的槽。 */
export const PET_SLOT_FOR_DSH = Object.freeze({
  page: 'dshPage',
  window: 'petPanels',
  settingsCard: 'dshCard',
  settingsWindow: 'petSettings',
})

/** 桌宠槽名 → DSH 槽名（反向表，供校验与双向查找）。 */
export const DSH_SLOT_FOR_PET = Object.freeze(
  Object.fromEntries(
    Object.entries(PET_SLOT_FOR_DSH).map(([dsh, pet]) => [pet, dsh]),
  ),
)
