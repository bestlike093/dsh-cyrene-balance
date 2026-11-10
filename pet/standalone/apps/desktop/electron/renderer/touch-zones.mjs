/**
 * 七段触摸分区：摸到哪里算哪个部位，各部位演一套本地反应。
 *
 * 出处：遐蝶桌宠驱动 live2d-driver（2026-11-10 定版）web/driver.mjs 的
 * ZONE_BANDS、zoneAt 与 react 的 reactions 表。驱动自述「代码本仓自写，
 * 形态参考鲸语 jingyu-live2d（MIT）」，分区比例与结构保留原样；
 * 台词换成昔涟口吻（原台词是遐蝶的），情绪与动作按 dsh-pet 的动作表折算。
 */

/**
 * 比例照驱动原注释：那具 chibi 模型包围盒 y≈83..499（CSS px），
 * 头顶 0.05、眼睛 0.58、下巴 0.67、腰 0.79、裙摆 0.92、脚 0.98。
 * 换成别的模型会偏，但分段顺序（头/脸/肩/胸/腰/裙/脚）是通用的。
 */
export const ZONE_BANDS = [
  { until: 0.5, id: 'head' },
  { until: 0.67, id: 'face' },
  { until: 0.73, id: 'shoulder' },
  { until: 0.79, id: 'chest' },
  { until: 0.88, id: 'waist' },
  { until: 0.945, id: 'skirt' },
  { until: 1.01, id: 'foot' },
]

/**
 * 返回 { zone, relY, relX }：部位名供状态栏与上报，比例留排查用。
 * bounds 形如 { x, y, width, height }。
 */
export function zoneAt(bounds, x, y) {
  const height = Math.max(1, bounds?.height ?? 0)
  const width = Math.max(1, bounds?.width ?? 0)
  const relY = Math.min(1, Math.max(0, (y - (bounds?.y ?? 0)) / height))
  const relX = Math.min(1, Math.max(0, (x - (bounds?.x ?? 0)) / width))
  const band = ZONE_BANDS.find((item) => relY < item.until) ?? ZONE_BANDS[ZONE_BANDS.length - 1]
  return { zone: band.id, relY: Math.round(relY * 1000) / 1000, relX: Math.round(relX * 1000) / 1000 }
}

/**
 * 各部位反应库：结构同驱动的 reactions（每部位三选一），
 * emotion 是 dsh-pet 情绪 tag，motion 是程序化动作名，
 * line 是本地兜底台词（昔涟口吻）。
 */
export const TOUCH_REACTIONS = {
  head: [
    { emotion: 'shy', motion: 'tilt', line: '呀……别揉头啦，会乱掉的。' },
    { emotion: 'shy', motion: 'tilt', line: '这里痒痒的……' },
    { emotion: 'thinking', motion: 'tilt', line: '被摸头的话，人家会变乖的哦。' },
  ],
  face: [
    { emotion: 'shy', motion: 'tilt', line: '脸有点烫……都怪你。' },
    { emotion: 'shy', motion: 'nod', line: '嗯，我在这里。' },
    { emotion: 'thinking', motion: 'tilt', line: '怎么啦，凑这么近。' },
  ],
  shoulder: [
    { emotion: 'excited', motion: 'nod', line: '肩膀借你靠一下？' },
    { emotion: 'excited', motion: 'nod', line: '嗯？我在听。' },
    { emotion: 'sad', motion: 'tilt', line: '拍轻一点啦……' },
  ],
  chest: [
    { emotion: 'shy', motion: 'tilt', line: '心跳……是不是被你听见了。' },
    { emotion: 'excited', motion: 'nod', line: '嗯，我就在这里。' },
    { emotion: 'thinking', motion: 'tilt', line: '这里，靠太近啦。' },
  ],
  waist: [
    { emotion: 'shy', motion: 'tilt', line: '好痒……别戳啦。' },
    { emotion: 'excited', motion: 'nod', line: '怎么啦？' },
    { emotion: 'sad', motion: 'tilt', line: '手有点凉哦，是不是该加衣服了。' },
  ],
  skirt: [
    { emotion: 'thinking', motion: 'tilt', line: '裙摆会皱的啦。' },
    { emotion: 'excited', motion: 'nod', line: '人家在呢。' },
    { emotion: 'shy', motion: 'tilt', line: '小心，别踩到。' },
  ],
  foot: [
    { emotion: 'thinking', motion: 'tilt', line: '脚踝很怕痒的……' },
    { emotion: 'excited', motion: 'nod', line: '站得稳，别担心。' },
    { emotion: 'shy', motion: 'tilt', line: '连这里也要碰吗……坏心眼。' },
  ],
}

/** 按部位随机挑一条；没有的部位回落到 chest（和驱动一致）。 */
export function pickTouchReaction(zone, random = Math.random) {
  const list = TOUCH_REACTIONS[zone] ?? TOUCH_REACTIONS.chest
  const pick = list[Math.floor(random() * list.length)]
  return { ...pick, zone: TOUCH_REACTIONS[zone] ? zone : 'chest' }
}
