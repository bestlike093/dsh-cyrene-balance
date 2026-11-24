/**
 * dsh-cyrene-pet — 设置字段总表（Settings schema）。
 *
 * 一份声明，多处使用：
 *   1. 客户端「恢复默认」按 path 取权威默认值；
 *   2. 后端 /settings/reset 校验 path 白名单；
 *   3. 测试比对本表默认值与 index.js 的 DEFAULTS 是否漂移；
 *   4. 设置页按 GROUPS/FIELDS 渲染导航与控件（schema 单一事实源）。
 *
 * key 用点路径表示嵌套字段（appearance.palette），和 state 结构同形。
 * 未列入本表的字段不提供「恢复默认」按钮，宁可少一个入口，也不写错默认。
 *
 * 信息架构：9 板块 + 免责声明（导航共 10 项），按主人指定方案。
 * 边界总规则：一个设置项只属于一个板块；每个板块只回答一个问题。
 * 字段归属见 docs（92 字段归位裁决表），归属唯一，validateSchema 兜底校验。
 */

export const SCHEMA_VERSION = 2

/**
 * 一级板块：设置页导航按这个顺序排。
 * question = 这个板块只回答的一个问题（人话）。
 * 免责声明是第 10 项导航，但它是页面不是板块，不进 GROUPS。
 */
export const GROUPS = [
  { id: 'identity', name: '她是谁', question: '她是谁，有着怎样的自我与内心' },
  { id: 'look', name: '她的样子', question: '她看起来是什么样子' },
  { id: 'ability', name: '她的能力', question: '她有哪些能力，哪些开着' },
  { id: 'memory', name: '她的记忆', question: '她记得什么，能记多少' },
  { id: 'speech', name: '她怎么说话', question: '她怎么把话说出来，花费花在哪' },
  { id: 'outside', name: '她和外面', question: '她连接了哪些外面的世界' },
  { id: 'proactive', name: '她什么时候主动', question: '她什么时候会主动来找你' },
  { id: 'advanced', name: '高级', question: '不常用的技术细节' },
  { id: 'system', name: '系统', question: '整个桌宠的运行与维护' },
]

/**
 * 免责声明：导航第 10 项（页面不是板块，不进 GROUPS）。
 * 文案与 9 板块一起经公开快照下发，设置页渲染。
 */
export const DISCLAIMER = {
  id: 'disclaimer',
  name: '免责声明',
  sections: [
    {
      title: '数据在哪里',
      text: '她的记忆、设置与密钥都保存在你自己的电脑上，不经过任何第三方服务器。',
    },
    {
      title: '联网与花费',
      text: '只有在你明确开启的能力里她才会联网。大模型接口按用量计费，花费和额度由你掌控；断开网络时她依然在。',
    },
    {
      title: '她说的话',
      text: '她的话由 AI 模型生成，可能不准确，也不构成医疗、法律或投资建议。重要决定请以现实里的可靠来源为准。',
    },
  ],
}

/**
 * 字段元数据约定：
 *  - type: bool | text | area | seg | range | number
 *  - effect: live 立即生效 / restart 需重启桌宠
 *  - group: 归属板块 id（GROUPS 之一，归属唯一）
 *  - section: 板块内小节标题（人话）
 *  - hint: 帮助文案（人话，不暴露原始参数名）
 *  - i18n: 文案字典 key（C 阶段挂接，ZH/EN 双字典）
 *  - deps: 可见性依赖。元素为 string 时表示该 key 为 true 才显示；
 *          元素为 { key, equals } 时表示该 key 值等于 equals 才显示。
 *  - danger: true 表示改动影响隐私/亲密行为，控件需要加确认
 *  - writeGroup: 同批提交的字段（一项改要带上同组其它值，防止互相冲回默认）
 *  - petPath: 桌宠端旧嵌套结构里的同语义路径（settings-sync 同步表由此派生，唯一权威）
 *  - petValues: [dsh值, pet值] 换算对，仅 seg 且两端取值不同时写
 *  - petFallback: pet 侧查不到换算时回退的值
 */
export const FIELDS = [
  /* ================= 她是谁 identity ================= */
  {
    key: 'nickname', label: '怎么称呼你', type: 'text', group: 'identity', section: '称呼与位置',
    default: '旅者', effect: 'live', maxLength: 24,
    hint: '她开口时叫你的名字，随时可以换',
    petPath: 'nickname'
  },
  /* 位置分两处：city 是她那边，ownerCity 是主人侧。留空各按各的规则，不互相顶替。 */
  {
    key: 'presence.city', label: '她所在城市', type: 'text', group: 'identity', section: '称呼与位置',
    default: '', effect: 'live', maxLength: 20,
    hint: '留空时她按自己的方式感知你在的城市',
  },
  {
    key: 'presence.ownerCity', label: '你所在城市', type: 'text', group: 'identity', section: '称呼与位置',
    default: '', effect: 'live', maxLength: 20,
    hint: '手动填的城市优先于自动定位',
  },
  {
    key: 'presence.autoLocate', label: '用 IP 自动定位她所在城市', type: 'bool', group: 'identity', section: '称呼与位置',
    default: false, effect: 'live',
    hint: '自动探测她所在的城市；当前还没有外壳接管这项探测，通常用「你所在城市」那组',
  },
  /*
   * 探测结果单独一格，不写回 city：
   * city 只存手填值，来源才能实时分开；探测失败或双源不一致时留空，不冒充自动定位。
   */
  {
    key: 'presence.autoLocatedCity', label: '自动定位结果', type: 'text', group: 'identity', section: '称呼与位置',
    default: '', effect: 'live', maxLength: 20,
    hint: '最近一次自动探测到的城市；还没探测过时显示「未接探测」',
  },

  /* 五条感受轴：她感知你的关系、摩擦、身体、记忆与主动程度的灵敏度。 */
  {
    key: 'companionAxes.relation.enabled', label: '关系感知', type: 'bool', group: 'identity', section: '她的感受轴',
    default: true, effect: 'live',
    hint: '感知你们的关系远近，影响她说话的距离感',
  },
  {
    key: 'companionAxes.relation.sensitivity', label: '关系灵敏度', type: 'seg', group: 'identity', section: '她的感受轴',
    default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']],
    hint: '灵敏度越高，越容易察觉关系里的细微变化',
    deps: ['companionAxes.relation.enabled']
  },
  {
    key: 'companionAxes.friction.enabled', label: '摩擦感知', type: 'bool', group: 'identity', section: '她的感受轴',
    default: true, effect: 'live',
    hint: '感知你们之间的不愉快，及时收住话头',
  },
  {
    key: 'companionAxes.friction.sensitivity', label: '摩擦灵敏度', type: 'seg', group: 'identity', section: '她的感受轴',
    default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']],
    hint: '灵敏度越高，越容易察觉话里的刺',
    deps: ['companionAxes.friction.enabled']
  },
  {
    key: 'companionAxes.body.enabled', label: '身体感知', type: 'bool', group: 'identity', section: '她的感受轴',
    default: true, effect: 'live',
    hint: '从作息和时间感知你的身体状态，累了就少打扰',
  },
  {
    key: 'companionAxes.body.sensitivity', label: '身体灵敏度', type: 'seg', group: 'identity', section: '她的感受轴',
    default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']],
    hint: '灵敏度越高，越容易察觉你累了',
    deps: ['companionAxes.body.enabled']
  },
  {
    key: 'companionAxes.memory.enabled', label: '记忆感知', type: 'bool', group: 'identity', section: '她的感受轴',
    default: true, effect: 'live',
    hint: '想起你们聊过的事，让对话有连贯感',
  },
  {
    key: 'companionAxes.memory.sensitivity', label: '记忆灵敏度', type: 'seg', group: 'identity', section: '她的感受轴',
    default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']],
    hint: '灵敏度越高，越频繁翻出旧话题',
    deps: ['companionAxes.memory.enabled']
  },
  {
    key: 'companionAxes.proactive.enabled', label: '主动感知', type: 'bool', group: 'identity', section: '她的感受轴',
    default: true, effect: 'live',
    hint: '察觉你什么时候想要她开口',
  },
  {
    key: 'companionAxes.proactive.sensitivity', label: '主动灵敏度', type: 'seg', group: 'identity', section: '她的感受轴',
    default: 'normal', effect: 'live',
    options: [['low', '低'], ['normal', '正常'], ['high', '高']],
    hint: '灵敏度越高，越容易找到开口的时机',
    deps: ['companionAxes.proactive.enabled']
  },

  /* ================= 她的样子 look ================= */
  {
    key: 'ui', label: '界面形态', type: 'seg', group: 'look', section: '立绘',
    default: 'pet', effect: 'restart',
    options: [['pet', '完整立绘'], ['card', '只要审批卡片']],
    hint: '完整立绘是常驻桌面的她，卡片模式只弹审批卡',
    petPath: 'uiMode'
  },
  {
    key: 'modelId', label: '素材包 ID', type: 'text', group: 'look', section: '立绘',
    default: '', effect: 'restart', maxLength: 80,
    hint: '留空用自带立绘；填了素材包 ID 就用那一套',
  },
  {
    key: 'modelNotice', label: '模型提示', type: 'text', group: 'look', section: '立绘',
    default: '', effect: 'live', maxLength: 200,
    hint: '素材包相关的状态与提醒会显示在这里',
  },
  {
    key: 'outline', label: '描边', type: 'seg', group: 'look', section: '立绘',
    default: 'light', effect: 'live',
    options: [['light', '白边'], ['dark', '深边'], ['auto', '按亮度'], ['none', '不加']],
    hint: '给立绘描一圈边，深色桌面也能看清她',
    petPath: 'presence.outline'
  },
  {
    key: 'scale', label: '缩放', type: 'range', group: 'look', section: '立绘',
    default: 1, effect: 'live', min: 0.6, max: 1.8, step: 0.05,
    hint: '拖到合适的大小，改完立刻生效',
    petPath: 'window.scale'
  },
  {
    key: 'poseSeconds', label: '姿势轮换', type: 'range', group: 'look', section: '立绘',
    default: 60, effect: 'live', min: 0, max: 600, step: 10,
    hint: '隔多久换一个姿势；拖到 0 就固定不动',
    petPath: 'poseEverySeconds'
  },

  {
    key: 'showHud', label: '显示状态栏', type: 'bool', group: 'look', section: '状态栏',
    default: true, effect: 'live',
    hint: '她脚下那条信息栏，关掉后立绘更干净',
    petPath: 'showHud'
  },
  {
    key: 'hudDetail', label: '状态栏详细度', type: 'seg', group: 'look', section: '状态栏',
    default: 'full', effect: 'live',
    options: [['full', '完整'], ['simple', '精简'], ['simple2', '极简']],
    hint: '完整带全部信息，极简只留最要紧的',
    deps: ['showHud'],
    petPath: 'hudDetail'
  },
  {
    key: 'hudAlpha', label: '状态栏不透明度', type: 'range', group: 'look', section: '状态栏',
    default: 0.93, effect: 'live', min: 0.4, max: 1, step: 0.01,
    hint: '调低一点让它不那么抢眼',
    deps: ['showHud'],
    petPath: 'hudAlpha'
  },

  {
    key: 'theme', label: '皮肤主题', type: 'seg', group: 'look', section: '配色与背景',
    default: 'pink', effect: 'live',
    options: [['pink', '樱粉'], ['blue', '夜蓝'], ['ink', '墨色']],
    hint: '整套界面跟着换色',
    petPath: 'theme.preset',
    petValues: [['pink', 'SakuraPink'], ['blue', 'OceanBlue'], ['ink', 'Paper']],
    petFallback: 'SakuraPink'
  },
  {
    key: 'appearance.skin', label: '接管聊天页样式', type: 'seg', group: 'look', section: '配色与背景',
    default: 'on', effect: 'live',
    options: [['on', '接管'], ['off', '不接管']],
    hint: '关掉后聊天页保持原本的样子，不受配色影响',
  },
  {
    key: 'appearance.palette', label: '配色', type: 'seg', group: 'look', section: '配色与背景',
    default: 'sakura', effect: 'live',
    options: [['sakura', '樱粉'], ['plainpaper', '素纸'], ['celadon', '青瓷']],
    hint: '聊天页与卡片的配色基调',
  },
  {
    key: 'appearance.bgBlur', label: '背景模糊', type: 'range', group: 'look', section: '配色与背景',
    default: 0, effect: 'live', min: 0, max: 24, step: 1,
    hint: '给背景照片加一点柔焦，0 是原样',
  },
  /* 照片之上那层配色纱的浓度。0 = 只剩白纱，照片原色；0.85 = 配色明显盖过照片。
     和 skin / palette / bgBlur 同属外观写入组，改一项不能把其他项冲回默认。 */
  {
    key: 'appearance.paletteStrength', label: '配色浓度', type: 'range', group: 'look', section: '配色与背景',
    default: 0.55, effect: 'live', min: 0, max: 0.85, step: 0.05,
    hint: '配色纱盖住照片的程度：越低越接近照片原色',
    writeGroup: 'appearance'
  },
  {
    key: 'background.dim', label: '遮罩浓度', type: 'range', group: 'look', section: '配色与背景',
    default: 0.35, effect: 'live', min: 0, max: 0.85, step: 0.01,
    hint: '压在背景上的暗度，让立绘更突出',
    writeGroup: 'background'
  },
  /* 同一张图可以同时铺到 DSH 页面和桌宠的独立窗口；桌宠立绘窗默认不铺，免得挡住桌面。 */
  {
    key: 'background.targets.page', label: '铺在 DSH 页面', type: 'bool', group: 'look', section: '配色与背景',
    default: true, effect: 'live',
    hint: '背景图铺在聊天页面后方',
    writeGroup: 'background'
  },
  {
    key: 'background.targets.window', label: '铺在桌宠窗口', type: 'bool', group: 'look', section: '配色与背景',
    default: true, effect: 'live',
    hint: '背景图也铺到桌宠自己的窗口里',
    writeGroup: 'background'
  },
  {
    key: 'background.windowBlur', label: '窗口背景模糊', type: 'range', group: 'look', section: '配色与背景',
    default: 0, effect: 'live', min: 0, max: 24, step: 1,
    hint: '只模糊桌宠窗口的背景，0 是原样',
    writeGroup: 'background'
  },
  {
    key: 'background.rotateMinutes', label: '背景自动轮换', type: 'range', group: 'look', section: '配色与背景',
    default: 0, effect: 'live', min: 0, max: 1440, step: 30,
    hint: '隔多久换一张背景图；0 表示不自动换',
    writeGroup: 'background'
  },

  /* ================= 她的能力 ability ================= */
  {
    key: 'vision.enabled', label: '开启视觉识别', type: 'bool', group: 'ability', section: '视觉识别',
    default: false, effect: 'live',
    hint: '开着她才能看懂你发来的图片；接口参数在「高级」板块',
  },

  /* ================= 她的记忆 memory ================= */
  {
    key: 'memoryEnabled', label: '自动记忆', type: 'bool', group: 'memory', section: '自动记忆',
    petPath: 'companion.memory.enabled',
    default: true, effect: 'live',
    hint: '她把你说的要紧事自动记下来；13 槽分类与记忆台入口也在这个板块',
  },
  /* memoryViewMode 不登记：视图的唯一编辑权威在记忆台（PUT /companion/memory 落盘），
     schema 再放一份就是第三个入口（check-memory-ownership R2a 盯着）。 */
  {
    key: 'memoryBridgePrivate', label: '主人私聊带主人记忆', type: 'bool', group: 'memory', section: '记忆台',
    default: false, effect: 'live',
    hint: '打开后，你本人的 QQ 私聊才会把主人桶一起带进来；陌生人的私聊永远只看到自己那段'
  },
  {
    key: 'memoryBridgeGroup', label: '主人所在群带主人记忆', type: 'bool', group: 'memory', section: '记忆台',
    default: false, effect: 'live',
    hint: '打开后，只有你本人在群里时才会并进主人桶；群聊与私聊仍各自成桶'
  },

  /* ================= 她怎么说话 speech ================= */
  {
    key: 'bubbleMode', label: '气泡内容', type: 'seg', group: 'speech', section: '气泡',
    default: 'rotate', effect: 'live',
    options: [['rotate', '轮换'], ['info', '只看信息'], ['talk', '只看台词'], ['today', '只看今日额度']],
    hint: '气泡里显示什么：台词、信息、今日额度还是轮着来',
    petPath: 'bubble.mode'
  },
  {
    key: 'bubbleFont', label: '气泡字号', type: 'range', group: 'speech', section: '气泡',
    default: 14.5, effect: 'live', min: 11, max: 20, step: 0.5,
    hint: '气泡里文字的大小',
    petPath: 'bubble.fontSize'
  },
  {
    key: 'bubbleWidth', label: '气泡宽度', type: 'range', group: 'speech', section: '气泡',
    default: 300, effect: 'live', min: 0, max: 600, step: 10,
    hint: '气泡最多多宽；0 表示让气泡自己撑',
    petPath: 'bubble.width'
  },
  {
    key: 'bubbleStickerSize', label: '气泡小表情', type: 'range', group: 'speech', section: '气泡',
    default: 64, effect: 'live', min: 24, max: 160, step: 4,
    hint: '气泡里配的小表情大小',
    petPath: 'bubble.stickerSize'
  },
  {
    key: 'bubbleRadius', label: '气泡圆角', type: 'range', group: 'speech', section: '气泡',
    default: 0, effect: 'live', min: 0, max: 28, step: 1,
    hint: '0 是直角，越大越圆',
    petPath: 'bubble.radius'
  },
  {
    key: 'bubbleAlpha', label: '气泡不透明度', type: 'range', group: 'speech', section: '气泡',
    default: 0.97, effect: 'live', min: 0.5, max: 1, step: 0.01,
    hint: '调低让气泡变透，不挡后面的东西',
    petPath: 'bubble.alpha'
  },
  /* 句末温度总开关：关掉后气泡原文照出，不再做语气后处理。 */
  {
    key: 'companion.bubbleTone', label: '气泡句末语气', type: 'bool', group: 'speech', section: '气泡',
    default: true, effect: 'live',
    hint: '开着她会在句尾带点语气；关掉后原话照出',
  },

  {
    key: 'speechEnabled', label: '念出声', type: 'bool', group: 'speech', section: '声音',
    default: false, effect: 'live',
    hint: '把她的话用声音读出来',
    petPath: 'voice.enabled'
  },
  {
    key: 'speechProvider', label: '语音引擎', type: 'seg', group: 'speech', section: '声音',
    default: 'system', effect: 'live',
    options: [['system', '系统语音'], ['local', '本机 TTS']],
    hint: '系统语音开箱即用；本机 TTS 音色更好但要在本机跑服务',
    deps: ['speechEnabled'],
    petPath: 'voice.provider'
  },
  {
    key: 'ttsEndpoint', label: 'TTS 地址', type: 'text', group: 'speech', section: '声音',
    default: 'http://127.0.0.1:9880', effect: 'live', maxLength: 300,
    hint: '本机 TTS 服务的地址，装好服务后一般不用改',
    deps: ['speechEnabled'],
    petPath: 'voice.localUrl'
  },
  {
    key: 'soundVolume', label: '音量', type: 'range', group: 'speech', section: '声音',
    default: 0.5, effect: 'live', min: 0, max: 1, step: 0.05,
    hint: '她说话的声音大小',
    deps: ['speechEnabled'],
    petPath: 'voice.volume'
  },

  {
    key: 'stickersEnabled', label: '允许贴表情包', type: 'bool', group: 'speech', section: '贴纸',
    default: true, effect: 'live',
    hint: '开着的时候她可以在回复里配表情包',
  },

  {
    key: 'balanceThreshold', label: '余额低于多少提醒我', type: 'number', group: 'speech', section: '花费',
    default: 20, effect: 'live', min: 0, max: 100000, step: 1,
    hint: '余额掉到这个数以下，她就会提醒你',
  },
  {
    key: 'dailyLimit', label: '今天最多花多少', type: 'number', group: 'speech', section: '花费',
    default: 0, effect: 'live', min: 0, max: 100000, step: 1,
    hint: '今日消费上限，单位元；0 表示不设限',
  },
  {
    key: 'refreshSeconds', label: '多久查一次余额', type: 'number', group: 'speech', section: '花费',
    default: 30, effect: 'live', min: 15, max: 300, step: 5,
    hint: '余额自动刷新的间隔，单位秒',
  },

  /* ================= 她和外面 outside ================= */
  {
    key: 'game.enabled', label: '感知游戏', type: 'bool', group: 'outside', section: '游戏感知',
    default: true, effect: 'live',
    hint: '你打游戏的时候她能察觉，自动切换到游戏模式',
  },
  {
    key: 'game.autoMode', label: '自动进游戏模式', type: 'bool', group: 'outside', section: '游戏感知',
    default: true, effect: 'live',
    hint: '进了游戏自动收起打扰项，退出来再恢复',
    deps: ['game.enabled']
  },
  {
    key: 'game.hideBubble', label: '游戏时收起气泡', type: 'bool', group: 'outside', section: '游戏感知',
    default: true, effect: 'live',
    hint: '打游戏的时候先别弹台词气泡',
    deps: ['game.enabled']
  },
  {
    key: 'game.dimPet', label: '游戏时立绘变淡', type: 'range', group: 'outside', section: '游戏感知',
    default: 0.65, effect: 'live', min: 0.2, max: 1, step: 0.05,
    hint: '游戏期间立绘的不透明度，减少遮挡',
    deps: ['game.enabled']
  },
  {
    key: 'watch.enabled', label: '开启陪看', type: 'bool', group: 'outside', section: '陪看',
    default: true, effect: 'live',
    hint: '开着的时候她能陪你一起看视频',
  },
  {
    key: 'watch.defaultUrl', label: '常看的地址', type: 'text', group: 'outside', section: '陪看',
    default: '', effect: 'live', maxLength: 300,
    hint: '陪看页默认打开的视频地址，可留空',
    deps: ['watch.enabled']
  },
  {
    key: 'danmaku.enabled', label: '开弹幕层', type: 'bool', group: 'outside', section: '弹幕',
    default: true, effect: 'live',
    hint: '陪看的时候飘弹幕',
  },
  {
    key: 'danmaku.fontSize', label: '弹幕字号', type: 'range', group: 'outside', section: '弹幕',
    default: 22, effect: 'live', min: 14, max: 40, step: 1,
    hint: '弹幕文字大小',
    deps: ['danmaku.enabled']
  },
  {
    key: 'danmaku.opacity', label: '弹幕不透明度', type: 'range', group: 'outside', section: '弹幕',
    default: 0.95, effect: 'live', min: 0.3, max: 1, step: 0.05,
    hint: '调低让弹幕变透，不遮视频',
    deps: ['danmaku.enabled']
  },
  {
    key: 'danmaku.seconds', label: '弹幕飘过用时', type: 'range', group: 'outside', section: '弹幕',
    default: 12, effect: 'live', min: 6, max: 30, step: 1,
    hint: '一条弹幕从头飘到尾的秒数',
    deps: ['danmaku.enabled']
  },
  {
    key: 'danmaku.tracks', label: '弹幕轨道数', type: 'range', group: 'outside', section: '弹幕',
    default: 7, effect: 'live', min: 3, max: 12, step: 1,
    hint: '同屏最多几条弹幕各占一轨',
    deps: ['danmaku.enabled']
  },
  {
    key: 'danmaku.idleMinutes', label: '弹幕静默收窗', type: 'range', group: 'outside', section: '弹幕',
    default: 5, effect: 'live', min: 1, max: 60, step: 1,
    hint: '没有新弹幕多久后把弹幕窗收起来',
    deps: ['danmaku.enabled']
  },

  {
    key: 'qq.enabled', label: '启用 QQ 通道', type: 'bool', group: 'outside', section: 'QQ 机器人',
    default: false, effect: 'restart',
    hint: '开着才能从 QQ 上找到她；下面几项在启用后出现',
    petPath: 'channels.qq.enabled'
  },
  {
    key: 'qq.privacyMode', label: '隐私模式', type: 'bool', group: 'outside', section: 'QQ 机器人',
    default: true, effect: 'live', danger: true,
    hint: '挡住 QQ 消息里的隐私内容不落入记忆；关闭需要确认',
    deps: ['qq.enabled']
  },
  {
    key: 'qq.appId', label: 'AppID', type: 'text', group: 'outside', section: 'QQ 机器人',
    default: '', effect: 'restart', maxLength: 64,
    hint: 'QQ 开放平台应用 ID',
    deps: ['qq.enabled'],
    petPath: 'channels.qq.appId'
  },
  {
    key: 'qq.targetKind', label: '推送目标类型', type: 'seg', group: 'outside', section: 'QQ 机器人',
    default: 'c2c', effect: 'live',
    options: [['c2c', '私聊'], ['group', '群聊']],
    hint: '她主动发消息时送到私聊还是群聊',
    deps: ['qq.enabled']
  },
  {
    key: 'qq.targetId', label: '推送目标 ID', type: 'text', group: 'outside', section: 'QQ 机器人',
    default: '', effect: 'live', maxLength: 80,
    hint: '接收她主动消息的会话 ID',
    deps: ['qq.enabled']
  },
  {
    key: 'qqVoiceEnabled', label: '允许 QQ 语音', type: 'bool', group: 'outside', section: 'QQ 机器人',
    default: false, effect: 'live',
    hint: '开着的时候她可以在 QQ 里发语音',
    deps: ['qq.enabled']
  },
  {
    key: 'qqVoiceMode', label: '什么时候发语音', type: 'seg', group: 'outside', section: 'QQ 机器人',
    default: 'wakeWord', effect: 'live',
    options: [['always', '每条都配'], ['wakeWord', '叫了名字才配']],
    hint: '每条回复都配语音，还是只有你点名要才配',
    deps: ['qq.enabled', 'qqVoiceEnabled']
  },
  {
    key: 'qqVoiceWakeWord', label: '语音触发词', type: 'text', group: 'outside', section: 'QQ 机器人',
    default: '发句语音', effect: 'live', maxLength: 40,
    hint: '消息里带这个词，她才回一条语音',
    deps: ['qq.enabled', 'qqVoiceEnabled']
  },

  /* ================= 她什么时候主动 proactive ================= */
  {
    key: 'askEveryMinutes', label: '提问间隔', type: 'range', group: 'proactive', section: '提问节奏',
    default: 45, effect: 'live', min: 0, max: 480, step: 5,
    hint: '隔多久向你提一次小问题；0 表示不主动提问',
    petPath: 'askEveryMinutes'
  },
  {
    key: 'askHandling', label: '提问由谁接', type: 'seg', group: 'proactive', section: '提问节奏',
    default: 'pet-all', effect: 'live',
    options: [['pet-all', '桌宠逐题'], ['pet-single', '只接单题'], ['both', '两边都问'], ['web', '只走网页卡片']],
    hint: '她提的问题由桌宠、网页哪边来收答案',
    petPath: 'askHandling'
  },
  {
    key: 'bondEnabled', label: '记录好感', type: 'bool', group: 'proactive', section: '陪伴',
    default: true, effect: 'live',
    hint: '记住你们相处的点滴，慢慢积累好感',
  },
  {
    key: 'openingEnabled', label: '允许主动开口', type: 'bool', group: 'proactive', section: '陪伴',
    default: true, effect: 'live',
    hint: '关掉后她只在被叫到的时候说话',
  },
  {
    key: 'intimacy.enabled', label: '开启亲密层', type: 'bool', group: 'proactive', section: '贴近时刻',
    default: false, effect: 'live', danger: true,
    hint: '更贴近的陪伴方式，开启前请确认你真的想要',
  },
  /* 亲密层四项的默认值随版本变化（公开版更严），这里写本机版的现值；
     真正恢复默认时以后端 DEFAULTS 为准，这里的 default 只用于文档和漂移比对。 */
  {
    key: 'intimacy.perDay', label: '每天次数', type: 'range', group: 'proactive', section: '贴近时刻',
    default: 8, effect: 'live', min: 1, max: 8, step: 1,
    hint: '每天最多几次',
    deps: ['intimacy.enabled']
  },
  {
    key: 'intimacy.cooldownHours', label: '冷却', type: 'range', group: 'proactive', section: '贴近时刻',
    default: 5, effect: 'live', min: 1, max: 24, step: 1,
    hint: '两次之间的最短间隔，单位小时',
    deps: ['intimacy.enabled']
  },
  {
    key: 'intimacy.idleHours', label: '闲置触发', type: 'range', group: 'proactive', section: '贴近时刻',
    default: 6, effect: 'live', min: 1, max: 24, step: 1,
    hint: '你多久没理她，她才会凑近，单位小时',
    deps: ['intimacy.enabled']
  },
  {
    key: 'intimacy.aftercareMinutes', label: '事后关怀', type: 'range', group: 'proactive', section: '贴近时刻',
    default: 120, effect: 'live', min: 5, max: 240, step: 5,
    hint: '贴近之后她安静陪你的时长，单位分钟',
    deps: ['intimacy.enabled']
  },
  {
    key: 'intimacy.gateEnabled', label: '启用门槛', type: 'bool', group: 'proactive', section: '贴近时刻',
    default: true, effect: 'live',
    hint: '亲密度不够时她不会凑近，先陪到熟悉再说',
    deps: ['intimacy.enabled']
  },
  {
    key: 'intimacy.style', label: '笔触档位', type: 'seg', group: 'proactive', section: '贴近时刻',
    default: 'auto', effect: 'live',
    options: [['auto', '自动'], ['soft', '轻'], ['plain', '平'], ['sharp', '重']],
    hint: '她写贴近文字时的分寸',
    deps: ['intimacy.enabled']
  },

  /* ================= 高级 advanced ================= */
  {
    key: 'vision.baseUrl', label: '视觉识别接口', type: 'text', group: 'advanced', section: '视觉接口',
    default: 'https://api.deepseek.com', effect: 'live', maxLength: 300,
    hint: '识别图片用的接口地址，一般不用改',
    deps: ['vision.enabled']
  },
  {
    key: 'vision.model', label: '视觉模型', type: 'text', group: 'advanced', section: '视觉接口',
    default: 'deepseek-v4-flash-vision-exp', effect: 'live', maxLength: 120,
    hint: '识别图片用的模型名',
    deps: ['vision.enabled']
  },
  {
    key: 'ttsRefAudio', label: 'TTS 参考音频', type: 'text', group: 'advanced', section: '语音素材',
    default: '', effect: 'live', maxLength: 500,
    hint: '本机 TTS 的音色参考音频路径，音色试听也用它',
  },
  /* 双端同步开关：关掉后桌宠设置窗与这里各写各的，互不覆盖 */
  {
    key: 'settingsSync', label: '双端设置同步', type: 'bool', group: 'advanced', section: '双端同步',
    default: true, effect: 'live',
    hint: '让桌宠的设置窗和这里共用同一份设置；关掉后各改各的',
  },
  {
    key: 'syncToken', label: '同步令牌', type: 'text', group: 'advanced', section: '双端同步',
    default: '', effect: 'restart', maxLength: 200,
    hint: '两台设备之间同步设置用的口令，改完要重启',
  },
  {
    key: 'game.launcherUrl', label: 'dsh-launcher 地址', type: 'text', group: 'advanced', section: '外部工具',
    default: '', effect: 'live', maxLength: 300,
    hint: '启动器服务地址，不接启动器就留空',
  },
  {
    key: 'game.m7aPath', label: '三月七小助手路径', type: 'text', group: 'advanced', section: '外部工具',
    default: '', effect: 'live', maxLength: 500,
    hint: '三月七小助手在本机的路径，没装就留空',
  },

  /* ================= 系统 system ================= */
  {
    key: 'enabled', label: '启用桌宠', type: 'bool', group: 'system', section: '总开关',
    default: true, effect: 'restart',
    hint: '整个桌宠的总开关，关掉后她就不在了；重新打开要重启',
  },
]

const FIELD_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]))

const GROUP_BY_ID = new Map(GROUPS.map((group) => [group.id, group]))

export function getField(key) {
  return FIELD_BY_KEY.get(key) ?? null
}

export function getGroup(id) {
  return GROUP_BY_ID.get(id) ?? null
}

export function listFields(group) {
  return group === undefined ? FIELDS.slice() : FIELDS.filter((field) => field.group === group)
}

/** 板块内小节按 FIELDS 出现顺序去重。 */
export function listSections(group) {
  const seen = new Set()
  const sections = []
  for (const field of listFields(group)) {
    if (field.section && !seen.has(field.section)) {
      seen.add(field.section)
      sections.push(field.section)
    }
  }
  return sections
}

/**
 * schema 自检：返回问题列表，空数组 = 通过。
 * 兜底「归属唯一」：key 不重复、group 必须存在。
 */
export function validateSchema() {
  const problems = []
  const seenKeys = new Set()
  for (const field of FIELDS) {
    if (seenKeys.has(field.key)) problems.push(`duplicate key: ${field.key}`)
    seenKeys.add(field.key)
    if (!GROUP_BY_ID.has(field.group)) problems.push(`unknown group "${field.group}" on ${field.key}`)
    if (field.type === 'seg' && (!Array.isArray(field.options) || field.options.length === 0)) {
      problems.push(`seg without options: ${field.key}`)
    }
    if (Array.isArray(field.deps)) {
      for (const dep of field.deps) {
        const depKey = typeof dep === 'string' ? dep : dep?.key
        if (depKey && !FIELD_BY_KEY.has(depKey)) problems.push(`dep on unknown key "${depKey}" (${field.key})`)
      }
    }
  }
  return problems
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
