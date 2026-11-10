/**
 * dsh-cyrene-pet — 设置字段总表（Settings schema）。
 *
 * 一份声明，三处使用：
 *   1. 客户端「恢复默认」按 path 取权威默认值；
 *   2. 后端 /settings/reset 校验 path 白名单；
 *   3. 测试比对本表默认值与 index.js 的 DEFAULTS 是否漂移。
 *
 * key 用点路径表示嵌套字段（appearance.palette），和 state 结构同形。
 * 未列入本表的字段不提供「恢复默认」按钮，宁可少一个入口，也不写错默认。
 */

export const SCHEMA_VERSION = 1

/* 一级分组：设置页导航按这个顺序排。 */
export const GROUPS = [
  ['basic', '基本'],
  ['look', '样子'],
  ['talk', '说话'],
  ['active', '主动'],
  ['game', '游戏 · 陪看'],
  ['data', '系统'],
]

/* type: bool | text | area | seg | range | number
 * effect: live 立即生效 / restart 需重启桌宠
 * group: 一级分组
 * writeGroup: 同批提交的字段（schema 生成页面时用，一项改要带上同组其它值）
 */
export const FIELDS = [
  /* ---------- 基本 ---------- */
  { key: 'enabled', label: '启用桌宠', type: 'bool', group: 'basic', default: true, effect: 'restart' },
  { key: 'nickname', label: '怎么称呼你', type: 'text', group: 'basic', default: '旅者', effect: 'live', maxLength: 24 },
  { key: 'ui', label: '界面形态', type: 'seg', group: 'basic', default: 'pet', effect: 'restart',
    options: [['pet', '完整立绘'], ['card', '只要审批卡片']] },
  { key: 'theme', label: '皮肤主题', type: 'seg', group: 'basic', default: 'pink', effect: 'live',
    options: [['pink', '樱粉'], ['blue', '夜蓝'], ['ink', '墨色']] },
  /* 位置分两处：city 是她那边，ownerCity 是主人侧。留空各按各的规则，不互相顶替。 */
  { key: 'presence.city', label: '她所在城市', type: 'text', group: 'basic', default: '', effect: 'live', maxLength: 20 },
  { key: 'presence.ownerCity', label: '你所在城市', type: 'text', group: 'basic', default: '', effect: 'live', maxLength: 20 },
  { key: 'presence.autoLocate', label: '用 IP 自动定位你所在城市', type: 'bool', group: 'basic', default: false, effect: 'live' },
  /*
   * 探测结果单独一格，不写回 city：
   * city 只存手填值，来源才能实时分开；探测失败或双源不一致时留空，不冒充自动定位。
   */
  { key: 'presence.autoLocatedCity', label: '自动定位结果', type: 'text', group: 'basic', default: '', effect: 'live', maxLength: 20 },

  /* ---------- 样子 ---------- */
  { key: 'renderer', label: '渲染方式', type: 'seg', group: 'look', default: 'sprite', effect: 'restart',
    options: [['sprite', '静态立绘'], ['live2d', 'Live2D']] },
  { key: 'modelId', label: '素材包 ID', type: 'text', group: 'look', default: '', effect: 'restart', maxLength: 80 },
  { key: 'modelNotice', label: '模型提示', type: 'text', group: 'look', default: '', effect: 'live', maxLength: 200 },
  { key: 'outline', label: '描边', type: 'seg', group: 'look', default: 'light', effect: 'live',
    options: [['light', '白边'], ['dark', '深边'], ['auto', '按亮度'], ['none', '不加']] },
  { key: 'scale', label: '缩放', type: 'range', group: 'look', default: 1, effect: 'live', min: 0.6, max: 1.8, step: 0.05 },
  { key: 'poseSeconds', label: '姿势轮换', type: 'range', group: 'look', default: 60, effect: 'live', min: 0, max: 600, step: 10 },

  /* ---------- 说话 ---------- */
  { key: 'bubbleMode', label: '气泡内容', type: 'seg', group: 'talk', default: 'rotate', effect: 'live',
    options: [['rotate', '轮换'], ['info', '只看信息'], ['talk', '只看台词'], ['today', '只看今日额度']] },
  { key: 'bubbleFont', label: '气泡字号', type: 'range', group: 'talk', default: 14.5, effect: 'live', min: 11, max: 20, step: 0.5 },
  { key: 'bubbleWidth', label: '气泡宽度', type: 'range', group: 'talk', default: 300, effect: 'live', min: 0, max: 600, step: 10 },
  { key: 'bubbleStickerSize', label: '气泡小表情', type: 'range', group: 'talk', default: 64, effect: 'live', min: 24, max: 160, step: 4 },
  { key: 'bubbleRadius', label: '气泡圆角', type: 'range', group: 'talk', default: 0, effect: 'live', min: 0, max: 18, step: 1 },
  { key: 'bubbleAlpha', label: '气泡不透明度', type: 'range', group: 'talk', default: 0.97, effect: 'live', min: 0.5, max: 1, step: 0.01 },
  { key: 'showHud', label: '显示状态条', type: 'bool', group: 'talk', default: true, effect: 'live' },
  { key: 'hudDetail', label: '状态条详细度', type: 'seg', group: 'talk', default: 'full', effect: 'live',
    options: [['full', '完整'], ['simple', '精简'], ['simple2', '极简']] },
  { key: 'hudAlpha', label: '状态条不透明度', type: 'range', group: 'talk', default: 0.93, effect: 'live', min: 0.4, max: 1, step: 0.01 },
  { key: 'speechEnabled', label: '念出声', type: 'bool', group: 'talk', default: false, effect: 'live' },
  { key: 'speechProvider', label: '语音引擎', type: 'seg', group: 'talk', default: 'system', effect: 'live',
    options: [['system', '系统语音'], ['local', '本机 TTS']] },
  { key: 'ttsEndpoint', label: 'TTS 地址', type: 'text', group: 'talk', default: 'http://127.0.0.1:9880', effect: 'live', maxLength: 300 },
  { key: 'ttsRefAudio', label: '参考音频', type: 'text', group: 'talk', default: '', effect: 'live', maxLength: 500 },
  { key: 'soundVolume', label: '音量', type: 'range', group: 'talk', default: 0.5, effect: 'live', min: 0, max: 1, step: 0.05 },
  { key: 'stickersEnabled', label: '允许贴表情包', type: 'bool', group: 'talk', default: true, effect: 'live' },
  /* 句末温度总开关：关掉后气泡原文照出，不再做语气后处理。 */
  { key: 'companion.bubbleTone', label: '气泡句末语气', type: 'bool', group: 'talk', default: true, effect: 'live' },

  /* ---------- 主动 ---------- */
  { key: 'askEveryMinutes', label: '提问间隔', type: 'range', group: 'active', default: 45, effect: 'live', min: 0, max: 480, step: 5 },
  { key: 'askHandling', label: '提问由谁接', type: 'seg', group: 'active', default: 'pet-all', effect: 'live',
    options: [['pet-all', '桌宠逐题'], ['pet-single', '只接单题'], ['both', '两边都问'], ['web', '只走网页卡片']] },
  { key: 'bondEnabled', label: '记录好感', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'openingEnabled', label: '允许主动开口', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'memoryEnabled', label: '自动记忆', type: 'bool', group: 'active', default: true, effect: 'live' },

  { key: 'companionAxes.relation.enabled', label: '关系感知', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'companionAxes.relation.sensitivity', label: '关系灵敏度', type: 'seg', group: 'active', default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']] },
  { key: 'companionAxes.friction.enabled', label: '摩擦感知', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'companionAxes.friction.sensitivity', label: '摩擦灵敏度', type: 'seg', group: 'active', default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']] },
  { key: 'companionAxes.body.enabled', label: '身体感知', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'companionAxes.body.sensitivity', label: '身体灵敏度', type: 'seg', group: 'active', default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']] },
  { key: 'companionAxes.memory.enabled', label: '记忆感知', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'companionAxes.memory.sensitivity', label: '记忆灵敏度', type: 'seg', group: 'active', default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']] },
  { key: 'companionAxes.proactive.enabled', label: '主动感知', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'companionAxes.proactive.sensitivity', label: '主动灵敏度', type: 'seg', group: 'active', default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']] },

  { key: 'intimacy.enabled', label: '开启亲密层', type: 'bool', group: 'active', default: false, effect: 'live' },
  /* 亲密层四项的默认值随版本变化（公开版更严），这里写本机版的现值；
     真正恢复默认时以后端 DEFAULTS 为准，这里的 default 只用于文档和漂移比对。 */
  { key: 'intimacy.perDay', label: '每天次数', type: 'range', group: 'active', default: 8, effect: 'live', min: 1, max: 8, step: 1 },
  { key: 'intimacy.cooldownHours', label: '冷却', type: 'range', group: 'active', default: 5, effect: 'live', min: 1, max: 24, step: 1 },
  { key: 'intimacy.idleHours', label: '闲置触发', type: 'range', group: 'active', default: 6, effect: 'live', min: 1, max: 24, step: 1 },
  { key: 'intimacy.aftercareMinutes', label: '事后关怀', type: 'range', group: 'active', default: 120, effect: 'live', min: 5, max: 240, step: 5 },
  { key: 'intimacy.gateEnabled', label: '启用门槛', type: 'bool', group: 'active', default: true, effect: 'live' },
  { key: 'intimacy.style', label: '笔触档位', type: 'seg', group: 'active', default: 'auto', effect: 'live',
    options: [['auto', '自动'], ['soft', '轻'], ['plain', '平'], ['sharp', '重']] },

  /* ---------- 游戏 · 陪看 ----------
     只读感知，不启动游戏、不代跑任务；地址与路径都可留空。
     section 是页内小节标题：同一页签里按「感知 / 游戏时 / 陪看 / 弹幕 / 外部工具」排。 */
  { key: 'game.enabled', label: '感知游戏', type: 'bool', group: 'game', section: '感知', default: true, effect: 'live' },
  { key: 'game.pollSeconds', label: '检查间隔', type: 'range', group: 'game', section: '感知', default: 15, effect: 'live', min: 5, max: 120, step: 5 },
  { key: 'game.autoMode', label: '自动进游戏模式', type: 'bool', group: 'game', section: '游戏时', default: true, effect: 'live' },
  { key: 'game.hideBubble', label: '收起气泡', type: 'bool', group: 'game', section: '游戏时', default: true, effect: 'live' },
  { key: 'game.dimPet', label: '立绘不透明度', type: 'range', group: 'game', section: '游戏时', default: 0.65, effect: 'live', min: 0.2, max: 1, step: 0.05 },
  { key: 'watch.enabled', label: '开启陪看', type: 'bool', group: 'game', section: '陪看', default: true, effect: 'live' },
  { key: 'watch.defaultUrl', label: '常看的地址', type: 'text', group: 'game', section: '陪看', default: '', effect: 'live', maxLength: 300 },
  { key: 'danmaku.enabled', label: '开弹幕层', type: 'bool', group: 'game', section: '弹幕', default: true, effect: 'live' },
  { key: 'danmaku.fontSize', label: '字号', type: 'range', group: 'game', section: '弹幕', default: 22, effect: 'live', min: 14, max: 40, step: 1 },
  { key: 'danmaku.opacity', label: '不透明度', type: 'range', group: 'game', section: '弹幕', default: 0.95, effect: 'live', min: 0.3, max: 1, step: 0.05 },
  { key: 'danmaku.seconds', label: '飘过用时', type: 'range', group: 'game', section: '弹幕', default: 12, effect: 'live', min: 6, max: 30, step: 1 },
  { key: 'danmaku.tracks', label: '轨道数', type: 'range', group: 'game', section: '弹幕', default: 7, effect: 'live', min: 3, max: 12, step: 1 },
  { key: 'danmaku.idleMinutes', label: '静默收窗', type: 'range', group: 'game', section: '弹幕', default: 5, effect: 'live', min: 1, max: 60, step: 1 },
  { key: 'game.launcherUrl', label: 'dsh-launcher 地址', type: 'text', group: 'game', section: '外部工具', default: '', effect: 'live', maxLength: 300 },
  { key: 'game.m7aPath', label: '三月七小助手路径', type: 'text', group: 'game', section: '外部工具', default: '', effect: 'live', maxLength: 500 },

  /* ---------- 系统 ---------- */
  { key: 'background.dim', label: '遮罩浓度', type: 'range', group: 'data', default: 0.35, effect: 'live', min: 0, max: 0.85, step: 0.01 },
  /* 同一张图可以同时铺到 DSH 页面和桌宠的独立窗口；桌宠立绘窗默认不铺，免得挡住桌面。 */
  { key: 'background.targets.page', label: '铺在 DSH 页面', type: 'bool', group: 'data', default: true, effect: 'live' },
  { key: 'background.targets.window', label: '铺在桌宠窗口', type: 'bool', group: 'data', default: true, effect: 'live' },
  { key: 'background.windowBlur', label: '窗口背景模糊', type: 'range', group: 'data', default: 0, effect: 'live', min: 0, max: 24, step: 1 },
  { key: 'background.rotateMinutes', label: '自动轮换', type: 'range', group: 'data', default: 0, effect: 'live', min: 0, max: 1440, step: 30 },
  { key: 'appearance.skin', label: '接管聊天页样式', type: 'seg', group: 'data', default: 'on', effect: 'live',
    options: [['on', '接管'], ['off', '不接管']] },
  { key: 'appearance.palette', label: '配色', type: 'seg', group: 'data', default: 'sakura', effect: 'live',
    options: [['sakura', '樱粉'], ['plainpaper', '素纸'], ['celadon', '青瓷']] },
  { key: 'appearance.bgBlur', label: '背景模糊', type: 'range', group: 'data', default: 0, effect: 'live', min: 0, max: 24, step: 1 },
  /* 照片之上那层配色纱的浓度。0 = 只剩白纱，照片原色；0.85 = 配色明显盖过照片。
     和 skin / palette / bgBlur 同属外观写入组，改一项不能把其他项冲回默认。 */
  { key: 'appearance.paletteStrength', label: '配色浓度', type: 'range', group: 'data', default: 0.55, effect: 'live', min: 0, max: 0.85, step: 0.05 },

  { key: 'balanceThreshold', label: '余额提醒阈值', type: 'number', group: 'data', default: 20, effect: 'live', min: 0, max: 100000, step: 1 },
  { key: 'dailyLimit', label: '今日额度', type: 'number', group: 'data', default: 0, effect: 'live', min: 0, max: 100000, step: 1 },
  { key: 'refreshSeconds', label: '余额刷新间隔', type: 'number', group: 'data', default: 30, effect: 'live', min: 15, max: 300, step: 5 },
  /* 双端同步开关：关掉后桌宠设置窗与这里各写各的，互不覆盖 */
  { key: 'settingsSync', label: '双端设置同步', type: 'bool', group: 'data', default: true, effect: 'live' },
  { key: 'syncToken', label: '同步令牌', type: 'text', group: 'data', default: '', effect: 'restart', maxLength: 200 },

  { key: 'vision.enabled', label: '开启视觉识别', type: 'bool', group: 'data', default: false, effect: 'live' },
  { key: 'vision.baseUrl', label: '识别接口', type: 'text', group: 'data', default: 'https://api.deepseek.com', effect: 'live', maxLength: 300 },
  { key: 'vision.model', label: '视觉模型', type: 'text', group: 'data', default: 'deepseek-v4-flash-vision-exp', effect: 'live', maxLength: 120 },

  { key: 'qq.enabled', label: '启用 QQ 通道', type: 'bool', group: 'data', default: false, effect: 'restart' },
  { key: 'qq.privacyMode', label: '隐私模式', type: 'bool', group: 'data', default: true, effect: 'live' },
  { key: 'qq.appId', label: 'AppID', type: 'text', group: 'data', default: '', effect: 'restart', maxLength: 64 },
  { key: 'qq.targetKind', label: '推送目标类型', type: 'seg', group: 'data', default: 'c2c', effect: 'live',
    options: [['c2c', '私聊'], ['group', '群聊']] },
  { key: 'qq.targetId', label: '推送目标 ID', type: 'text', group: 'data', default: '', effect: 'live', maxLength: 80 },
  { key: 'qqVoiceEnabled', label: '允许 QQ 语音', type: 'bool', group: 'data', default: false, effect: 'live' },
  { key: 'qqVoiceMode', label: '什么时候发语音', type: 'seg', group: 'data', default: 'wakeWord', effect: 'live',
    options: [['always', '每条都配'], ['wakeWord', '叫了名字才配']] },
  { key: 'qqVoiceWakeWord', label: '语音触发词', type: 'text', group: 'data', default: '发句语音', effect: 'live', maxLength: 40 },
]

const FIELD_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]))

export function getField(key) {
  return FIELD_BY_KEY.get(key) ?? null
}

export function listFields(group) {
  return group === undefined ? FIELDS.slice() : FIELDS.filter((field) => field.group === group)
}

/** 按点路径读对象；读不到返回 undefined。 */
export function readPath(object, path) {
  if (object === null || typeof object !== 'object') return undefined
  const parts = String(path).split('.')
  let cursor = object
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[part]
  }
  return cursor
}

/** 已知字段 → 默认值；未登记字段返回 NOT_FOUND，调用方据此拒绝。 */
export const RESET_NOT_FOUND = Symbol('reset-not-found')

export function defaultFor(path, defaults) {
  const field = FIELD_BY_KEY.get(path)
  if (!field) return RESET_NOT_FOUND
  if (defaults === undefined) return field.default
  const value = readPath(defaults, path)
  return value === undefined ? field.default : value
}

/** 校验表与后端 DEFAULTS 是否漂移，返回不一致的路径列表。 */
export function diffWithDefaults(defaults) {
  const drift = []
  for (const field of FIELDS) {
    const value = readPath(defaults, field.key)
    if (value === undefined) {
      drift.push({ key: field.key, reason: 'missing' })
    } else if (JSON.stringify(value) !== JSON.stringify(field.default)) {
      drift.push({ key: field.key, reason: 'mismatch', table: field.default, actual: value })
    }
  }
  return drift
}
