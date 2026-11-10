/**
 * 中文动作名 → 动作解析。
 *
 * 出处：遐蝶桌宠驱动 live2d-driver（2026-11-10 定版）web/driver.mjs 的
 * ACTION_MAP 与 playActionByName。驱动自述「代码本仓自写，
 * 形态参考鲸语 jingyu-live2d（MIT）」，映射表内容与降级策略保留原样。
 *
 * 接入 dsh-pet 的用法：motion.mjs 的 play() 先走自己的 resolveActionKey
 * （程序化动作表），查不到再走这里的 resolveDriverAction：
 * 先翻这张表落到我们的动作 key，再看模型自带的原生动作组有没有
 * 同名动作 —— 驱动里「模型没有的动作找相近的」就是这一步。
 */

/** 驱动原表：[动作组, 组内动作名]。第二项是名字，不是下标。 */
export const DRIVER_ACTION_MAP = {
  点头: ['小动作', '点头'],
  摇头: ['小动作', '摇头'],
  歪头: ['小动作', '歪头'],
  张望: ['小动作', '张望'],
  看过来: ['小动作', '张望'],
  害羞: ['小动作', '歪头'],
  轻晃: ['小动作', '歪头'],
  弹一下: ['小动作', '点头'],
  打瞌睡: ['Sleep', null],
}

/**
 * 驱动动作名 → 我们程序化动作表的 key。
 * 驱动的「相近映射」也在这里：看过来/轻晃 → 张望 → 歪头，落到我们已有的动作上。
 */
const DRIVER_NAME_TO_KEY = {
  点头: 'nod',
  摇头: 'shake',
  歪头: 'tilt',
  张望: 'look',
  看过来: 'look',
  害羞: 'shy',
  轻晃: 'sway',
  弹一下: 'bounce',
  打瞌睡: 'sleepyNod',
}

/** 归一化：小写、去空格连字符，跨命名风格匹配。 */
export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, '')
}

/**
 * 驱动动作名落到我们程序化动作的 key。
 * 不认识的输入返回 null，不猜。
 */
export function resolveDriverActionKey(request) {
  if (typeof request !== 'string') return null
  const key = request.trim()
  if (key === '') return null
  return DRIVER_NAME_TO_KEY[key] ?? null
}

/**
 * 在模型自带动作里找一个和请求名对得上的。
 * capability 是 probeMotionCapability 的结果；native 是 [{group,index,name}]。
 * 完全相等优先；包含次之，作为「相近动作」的降级依据。
 * 找不到返回 null，交给调用方走参数通道。
 */
export function resolveNativeMotion(capability, request) {
  if (typeof request !== 'string') return null
  const q = normalizeName(request)
  if (q === '') return null
  const list = Array.isArray(capability?.native) ? capability.native : []
  if (list.length === 0) return null

  let best = null
  let bestScore = 0
  for (const item of list) {
    const c = normalizeName(item?.name)
    if (c === '') continue
    let score = 0
    if (c === q) score = 100
    else if (c.includes(q) || q.includes(c)) score = 60
    if (score > bestScore) {
      bestScore = score
      best = item
    }
  }
  return bestScore >= 60 ? best : null
}
