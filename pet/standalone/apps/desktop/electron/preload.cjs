// 渲染进程唯一入口：只暴露固定方法，不暴露 ipcRenderer 本身。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  // 弹幕层专用：主进程推一条，页面就横着放一条。返回取消订阅函数。
  onDanmaku: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, item) => handler(item)
    ipcRenderer.on('pet:danmaku:item', listener)
    return () => ipcRenderer.removeListener('pet:danmaku:item', listener)
  },
  getSettings: () => ipcRenderer.invoke('pet:settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('pet:settings:save', settings),
  getAssessmentSchema: () => ipcRenderer.invoke('pet:assessment:schema'),
  scoreAssessment: (answers) => ipcRenderer.invoke('pet:assessment:score', answers),
  saveAssessment: (payload) => ipcRenderer.invoke('pet:assessment:save', payload),
  setClickThrough: (enabled) => ipcRenderer.invoke('pet:window:setClickThrough', enabled),
  // 像素级穿透：渲染层按 elementFromPoint 命中结果切换可点/穿透。
  setPixelHit: (interactive) => ipcRenderer.invoke('pet:window:setPixelHit', interactive === true),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('pet:window:setAlwaysOnTop', enabled),
  move: (x, y) => ipcRenderer.invoke('pet:window:move', { x, y }),
  // 一键归位：主进程把窗口贴到主屏右下角，渲染侧不用自己算多屏坐标。
  dockToBottomRight: () => ipcRenderer.invoke('pet:window:move', { dock: 'bottom-right' }),
  // 拖拽：渲染侧只发开始/结束，位置跟随由主进程读光标完成。
  dragStart: () => ipcRenderer.invoke('pet:window:dragStart'),
  dragEnd: (velocity) => ipcRenderer.invoke('pet:window:dragEnd', velocity),
  diagnostics: () => ipcRenderer.invoke('pet:diagnostics:collect'),
  // 语感学习：设置页读列表、裁决待审、开关总闸。
  listSpeechHabits: (scope) => ipcRenderer.invoke('pet:speech:list', scope),
  resolveSpeechHabit: (scope, text, keep) =>
    ipcRenderer.invoke('pet:speech:resolve', { scope, text, keep: keep === true }),
  setSpeechLearning: (enabled) => ipcRenderer.invoke('pet:speech:learning', enabled === true),
  // Live2D 模型库：列表 / 当前生效模型 / 导入（zip 或文件夹）/ 切换 / 打开目录。
  // 导入会弹系统选择框，选完由主进程解压并校验，返回带 pet-media URL 的模型。
  listModels: () => ipcRenderer.invoke('pet:models:list'),
  getActiveModel: () => ipcRenderer.invoke('pet:models:active'),
  importModel: (kind) => ipcRenderer.invoke('pet:models:import', { kind }),
  setActiveModel: (modelId) => ipcRenderer.invoke('pet:models:setActive', modelId),
  openModelsFolder: () => ipcRenderer.invoke('pet:models:openFolder'),
  // 素材包：字体 / 图标 / 气泡 / 表情，统一走 zip 导入，存 userData/packs。
  // 返回的每个文件都带 pet-media://pack/<id>/<相对路径>，渲染侧拿不到绝对路径。
  listPacks: () => ipcRenderer.invoke('pet:packs:list'),
  importPack: () => ipcRenderer.invoke('pet:packs:import'),
  removePack: (packId) => ipcRenderer.invoke('pet:packs:remove', packId),
  setPackEnabled: (packId, enabled) =>
    ipcRenderer.invoke('pet:packs:setEnabled', packId, enabled === true),
  // 余额：主进程拿 Vault 里的 Key 查一次，明文不回渲染侧。
  queryBalance: () => ipcRenderer.invoke('pet:balance:query'),
  // 密钥：明文只在 setSecret 的入参里出现一次，读回来一律掩码。
  setSecret: (serviceId, value, field) =>
    ipcRenderer.invoke('pet:secrets:set', { serviceId, value, field }),
  getSecretMasked: (serviceId, field) =>
    ipcRenderer.invoke('pet:secrets:masked', { serviceId, field }),
  clearSecret: (serviceId, field) =>
    ipcRenderer.invoke('pet:secrets:clear', { serviceId, field }),
  qqTest: () => ipcRenderer.invoke('pet:qq:test'),
  qqStatus: () => ipcRenderer.invoke('pet:qq:status'),
  // 观察模式下把最近一条入站消息的发送者绑成主人；成功后主进程会重建通道。
  bindQqOwner: () => ipcRenderer.invoke('pet:qq:bind-owner'),
  // 语音：气泡出字时来要声音，主进程合完把音频交回来，自己负责播放。
  // 失败一律返回 ok:false，渲染侧静默跳过——没声音不该影响出字。
  // reason=manual 表示点小喇叭，不受「只在小喇叭被点时」这条设置挡。
  speakVoice: (text, reason = 'auto') => ipcRenderer.invoke('pet:voice:speak', { text, reason }),
  // 语音输入：状态 / 配置 / 提交音频。识别与唤醒词判定都在主进程，渲染侧只负责采集。
  asrStatus: () => ipcRenderer.invoke('pet:asr:status'),
  asrGetConfig: () => ipcRenderer.invoke('pet:asr:config'),
  asrSaveConfig: (patch) => ipcRenderer.invoke('pet:asr:save', patch),
  asrTranscribe: (buffer) => ipcRenderer.invoke('pet:asr:transcribe', buffer),
  asrMic: (action) => ipcRenderer.invoke('pet:asr:mic', action),
  // 本机识别：info=路径与就绪状态，install=装依赖和下模型，start=起本机服务。
  asrLocal: (action) => ipcRenderer.invoke('pet:asr:local', action),
  // 语音服务真实状态：只回 state，人话由界面按语言翻译。
  voiceStatus: () => ipcRenderer.invoke('pet:voice:status'),
  pickRefAudio: () => ipcRenderer.invoke('pet:voice:pickRefAudio'),
  testLlm: () => ipcRenderer.invoke('pet:llm:test'),
  runSync: (action) => ipcRenderer.invoke('pet:sync:run', { action }),
  getSyncInfo: () => ipcRenderer.invoke('pet:sync:info'),
  chooseSyncDir: () => ipcRenderer.invoke('pet:sync:chooseDir'),
  // 同步口令：只回是否配置成功，不回明文；状态接口只给掩码。
  setSyncPassphrase: (passphrase) => ipcRenderer.invoke('pet:sync:setPassphrase', { passphrase }),
  clearSyncPassphrase: () => ipcRenderer.invoke('pet:sync:clearPassphrase'),
  getSyncPassphraseStatus: () => ipcRenderer.invoke('pet:sync:passphraseStatus'),
  // 聊天：历史只在主进程内存里；失败原因是结构化字段，界面自己决定怎么说。
  sendChat: (text) => ipcRenderer.invoke('pet:chat:send', { text }),
  getChatHistory: () => ipcRenderer.invoke('pet:chat:history'),
  getChatStatus: () => ipcRenderer.invoke('pet:chat:status'),
  clearChat: () => ipcRenderer.invoke('pet:chat:clear'),
  exportChat: () => ipcRenderer.invoke('pet:chat:export'),
  openChat: () => ipcRenderer.invoke('pet:chat:open'),
  closeChat: () => ipcRenderer.invoke('pet:chat:close'),
  // 会话页：聊天历史与 QQ 会话合并在一页，tab 可选 'chat' | 'qq'。
  openSessions: (tab) => ipcRenderer.invoke('pet:sessions:open', { tab }),
  listQqConversations: () => ipcRenderer.invoke('pet:qq:conversations'),
  // 拍一张照：只回 { ok, photo:{ path, at, bytes } }，图像字节不进渲染层。
  takePhoto: () => ipcRenderer.invoke('pet:photo:take'),
  // 记忆：统计与分页读取；单条删除按 id 走，清空仍是整份清空。
  getMemoryStats: () => ipcRenderer.invoke('pet:memory:stats'),
  // 结构化事实：偏好 / 人物 / 项目 / 约定，只读。
  getMemoryFacts: (options) => ipcRenderer.invoke('pet:memory:facts', options),
  removeMemoryFact: (id) => ipcRenderer.invoke('pet:memory:facts:remove', { id }),
  updateMemoryFact: (id, text) => ipcRenderer.invoke('pet:memory:facts:update', { id, text }),
  exportMemoryFacts: (options) => ipcRenderer.invoke('pet:memory:facts:export', options),
  importMemoryFacts: (options) => ipcRenderer.invoke('pet:memory:facts:import', options),
  // 陪伴日程：读今天这份单，或把手动顺延的分钟数交给主进程判断。
  companionAgenda: () => ipcRenderer.invoke('pet:companion:agenda'),
  rescheduleAgenda: (minutes) => ipcRenderer.invoke('pet:companion:agenda:reschedule', { minutes }),
  // 观察台：整份只读快照；写动作只落在指定会话上，桌面与各群互不影响。
  openInsight: (tab) =>
    ipcRenderer.invoke('pet:insight:open', typeof tab === 'string' ? { tab } : {}),
  // 记忆页作用域列表：读插件进程写出的 memory-snapshot.json，观察台只读不写。
  getMemoryConsole: () => ipcRenderer.invoke('pet:memory-console:load'),
  // 观察台已开着时，主进程只发一条切页请求，不重新加载整页。
  onInsightTab: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, tab) => callback(tab)
    ipcRenderer.on('pet:insight:select-tab', listener)
    return () => ipcRenderer.removeListener('pet:insight:select-tab', listener)
  },
  getInsightSnapshot: (options) => ipcRenderer.invoke('pet:insight:snapshot', options),
  setInsightFavor: (scope, value, note) =>
    ipcRenderer.invoke('pet:insight:set-favor', { scope, value, note }),
  adjustInsightFavor: (scope, delta, note) =>
    ipcRenderer.invoke('pet:insight:adjust-favor', { scope, delta, note }),
  lockInsightFavor: (scope, locked) =>
    ipcRenderer.invoke('pet:insight:lock-favor', { scope, locked }),
  resetInsightScope: (scope) => ipcRenderer.invoke('pet:insight:reset-scope', { scope }),
  // 贴近时刻按会话开关：只对 QQ 私聊生效，桌面不在可改写范围内。
  setInsightIntimacy: (scope, enabled) =>
    ipcRenderer.invoke('pet:insight:set-intimacy', { scope, enabled }),
  // 让某一段关系消气：只投递一条意图，真正落状态由她那边做。
  setInsightFriction: (scope, value) =>
    ipcRenderer.invoke('pet:insight:set-friction', { scope, value }),
  deleteInsightMemory: (id) => ipcRenderer.invoke('pet:insight:delete-memory', { id }),
  listMemory: (options) => ipcRenderer.invoke('pet:memory:list', options),
  deleteMemory: (id) => ipcRenderer.invoke('pet:memory:delete', { id }),
  // 钉子：钉住的记忆不降温、不自动归档；再点一次取消。
  pinMemory: (id, pinned) => ipcRenderer.invoke('pet:memory:pin', { id, pinned }),
  exportMemory: (options) => ipcRenderer.invoke('pet:memory:export', options),
  clearMemory: () => ipcRenderer.invoke('pet:memory:clear'),
  // 启动前体检：一次拿齐模型、密钥、语音配置、磁盘与 Vault 状态。
  preflight: () => ipcRenderer.invoke('pet:preflight'),
  // 运行状态四卡片：只读汇总，不触发重连或模型请求。
  statusSummary: () => ipcRenderer.invoke('pet:status:summary'),
  // 人格预览：主进程真实拼装结果，供设置页展示。
  getPersonaPreview: () => ipcRenderer.invoke('pet:persona:preview'),
  // 右键桌宠：交给主进程弹原生菜单，渲染侧不自己画浮层。
  openContextMenu: (payload) => ipcRenderer.invoke('pet:menu:context', payload),
  // 独立设置窗：打开 / 关闭 / 应用尺寸 / 读实时状态。
  openSettings: (panel) => ipcRenderer.invoke('pet:settings:open', { panel }),
  // 聊天页背景：选图、清空、列清单。图片本体只在主进程里搬，渲染侧只拿 id。
  pickBackground: () => ipcRenderer.invoke('pet:background:pick'),
  clearBackground: () => ipcRenderer.invoke('pet:background:clear'),
  listBackgrounds: () => ipcRenderer.invoke('pet:background:list'),
  // 背景库页：选用已有图、删除文件、打开独立页。
  applyBackground: (id, slots) => ipcRenderer.invoke('pet:background:apply', id, slots),
  removeBackground: (id) => ipcRenderer.invoke('pet:background:remove', id),
  /* 五槽：分别给聊天窗 / 设置页 / 独立页面 / DSH 页面 / DSH 卡片设图。 */
  backgroundSlots: () => ipcRenderer.invoke('pet:background:slots'),
  setBackgroundSlot: (slot, patch) => ipcRenderer.invoke('pet:background:slot:set', slot, patch),
  openBackgrounds: () => ipcRenderer.invoke('pet:background:open'),
  closeSettings: () => ipcRenderer.invoke('pet:settings:close'),
  minimizeSettings: () => ipcRenderer.invoke('pet:settings:minimize'),
  toggleMaximizeSettings: () => ipcRenderer.invoke('pet:settings:toggleMaximize'),
  applyWindowSize: () => ipcRenderer.invoke('pet:window:applySize'),
  getWindowSize: () => ipcRenderer.invoke('pet:window:getSize'),
  getRenderInfo: () => ipcRenderer.invoke('pet:render:info'),
  // 主窗口把渲染侧状态报给主进程，供设置窗读取诊断。
  reportRenderInfo: (info) => ipcRenderer.invoke('pet:render:report', info),
  // 主动说话：结合时间 / 天气 / 记忆 / 心情生成一句；失败时主进程会给本地短句。
  speak: (reason) => ipcRenderer.invoke('pet:presence:speak', reason),
  // 加密仓库自检：只回状态码与计数，不回密钥材料。
  vaultDiagnose: () => ipcRenderer.invoke('pet:vault:diagnose'),
  // 备份：口令只在调用瞬间传给主进程，不落渲染侧存储。
  vaultExport: (password) => ipcRenderer.invoke('pet:vault:export', { password }),
  // 一键备份：目录与保留份数走独立小配置，口令仍只在这次调用里出现。
  backupConfig: () => ipcRenderer.invoke('pet:backup:getConfig'),
  backupChooseDir: () => ipcRenderer.invoke('pet:backup:chooseDir'),
  backupSetKeep: (keep) => ipcRenderer.invoke('pet:backup:setKeep', { keep }),
  backupRun: (password) => ipcRenderer.invoke('pet:backup:run', { password }),
  // 恢复出厂：主进程清完数据会自行重启，渲染侧只等这一次调用返回。
  factoryReset: () => ipcRenderer.invoke('pet:factory:reset'),
  // 自动备份：开启时若传了口令，主进程用系统密钥加密保存，渲染侧拿不到明文。
  backupSetAuto: (intervalDays, password) =>
    ipcRenderer.invoke('pet:backup:setAuto', { intervalDays, password }),
  backupFindLatest: () => ipcRenderer.invoke('pet:backup:findLatest'),
  vaultImport: (password) => ipcRenderer.invoke('pet:vault:import', { password }),
  // 轮换数据密钥：新写入换新钥，旧数据仍按原 keyId 可读。
  vaultRotate: () => ipcRenderer.invoke('pet:vault:rotate'),
  // 语音唤醒：默认关闭。运行时按需下载，装不装由用户决定；主进程不把音频交出来。
  wakeStatus: () => ipcRenderer.invoke('pet:wake:status'),
  wakeInstall: () => ipcRenderer.invoke('pet:wake:install'),
  wakeRemove: () => ipcRenderer.invoke('pet:wake:remove'),
  wakeSetEnabled: (enabled) => ipcRenderer.invoke('pet:wake:setEnabled', { enabled: enabled === true }),
  // 每日巡视与反思：手动触发一次，返回真实结果（没有数据也会说明原因）。
  dailyRun: () => ipcRenderer.invoke('pet:daily:run'),
  dailyLast: () => ipcRenderer.invoke('pet:daily:last'),
  reflectionRun: () => ipcRenderer.invoke('pet:reflection:run'),
  // 能力中心：打开独立窗口；猜拳三动作共用一条通道。
  openAbilityCenter: () => ipcRenderer.invoke('pet:ability:open'),
  // 游戏页：排班与记录从设置窗搬出去后，从这里打开。
  openGamePage: () => ipcRenderer.invoke('pet:game:open'),
  rps: (action, choice) => ipcRenderer.invoke('pet:game:rps', { action, choice }),
  // 游戏日常：检测、读/存排班、dry-run 预览。真实执行本轮没有开。
  gameDetect: () => ipcRenderer.invoke('pet:game:detect'),
  gameScheduleGet: () => ipcRenderer.invoke('pet:game:schedule:get'),
  gameScheduleSave: (config) => ipcRenderer.invoke('pet:game:schedule:save', config),
  gameDryRun: (config) => ipcRenderer.invoke('pet:game:dry-run', config),
  // 多游戏日常：每个游戏一份排班，注册计划任务后由 runner 无值守执行。
  gameDailyState: () => ipcRenderer.invoke('pet:game:daily:state'),
  gameDailyUpdate: (input) => ipcRenderer.invoke('pet:game:daily:update', input),
  gameDailyPlan: () => ipcRenderer.invoke('pet:game:daily:plan'),
  gameDailyApply: () => ipcRenderer.invoke('pet:game:daily:apply'),
  gameDailyQuery: () => ipcRenderer.invoke('pet:game:daily:query'),
  gameDailyDisable: (games) => ipcRenderer.invoke('pet:game:daily:disable', games),
  gameDailyRuns: (input) => ipcRenderer.invoke('pet:game:daily:runs', input),
  // 游戏助手：默认关闭，连续两次风险确认后才允许生成任务计划。
  gameAssistantStatus: () => ipcRenderer.invoke('pet:game:assistant:status'),
  gameAssistantConfirm: (input) => ipcRenderer.invoke('pet:game:assistant:confirm', input),
  gameAssistantDisable: () => ipcRenderer.invoke('pet:game:assistant:disable'),
  gameAssistantRecord: (entry) => ipcRenderer.invoke('pet:game:assistant:record', entry),
  gameAssistantClaim: (id) => ipcRenderer.invoke('pet:game:assistant:claim', id),
  gameAssistantRank: (rank) => ipcRenderer.invoke('pet:game:assistant:rank', rank),
  gameAssistantPlan: (taskId) => ipcRenderer.invoke('pet:game:assistant:plan', taskId),
  // 随包素材：只回名称与 pet-media 地址，渲染侧拿不到磁盘路径。
  listAssets: () => ipcRenderer.invoke('pet:assets:list'),
  // 表情包：QQ 偷来的图先进待审核队列，入库 / 丢弃必须由用户逐张点。
  listStickerInbox: () => ipcRenderer.invoke('pet:sticker:inbox'),
  // 表情库：内置素材 + 用户素材包，只读。
  listStickerLibrary: () => ipcRenderer.invoke('pet:sticker:library'),
  approveSticker: (id, options) =>
    ipcRenderer.invoke('pet:sticker:approve', { id, ...(options ?? {}) }),
  rejectSticker: (id) => ipcRenderer.invoke('pet:sticker:reject', { id }),
  openStickerWindow: () => ipcRenderer.invoke('pet:sticker:open'),
  // 只接受素材包内相对路径或 pet-media://pack/...，主进程会重新校验。
  sendSticker: (file) => ipcRenderer.invoke('pet:sticker:send', { file }),
  // 桌面状态条：先取一次快照，之后由主进程按 3 秒 / 6 秒两拍推送。
  systemStats: () => ipcRenderer.invoke('pet:system:stats'),
  // 心情：主进程按时间与对话间隔算出来的真实状态，只回标签与等级。
  presenceMood: () => ipcRenderer.invoke('pet:presence:mood'),
  onSystemStats: (callback) => {
    const handler = (_event, stats) => callback(stats)
    ipcRenderer.on('pet:system:stats', handler)
    return () => ipcRenderer.removeListener('pet:system:stats', handler)
  },
  // 主进程主动说一句（每日巡视小结）。事件通道，不走 invoke 白名单。
  onBubble: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('pet:bubble', handler)
    return () => ipcRenderer.removeListener('pet:bubble', handler)
  },
  // 余额气泡的「知道了」：点一下才把 ack 从 shown 升到 confirmed。
  ackBalance: (segment) => ipcRenderer.invoke('pet:balance:ack', segment),
  // 设置保存后主进程广播全量设置，主界面据此即时更新气泡 / HUD，不必重启。
  onSettingsChanged: (callback) => {
    const handler = (_event, next) => callback(next)
    ipcRenderer.on('pet:settings:changed', handler)
    return () => ipcRenderer.removeListener('pet:settings:changed', handler)
  },
  // 启动时密钥环重建/隔离只提示一次；返回解绑函数，和生命周期事件同约定。
  onVaultNotice: (callback) => {
    const handler = (_event, notice) => callback(notice)
    ipcRenderer.on('pet:vault:notice', handler)
    return () => ipcRenderer.removeListener('pet:vault:notice', handler)
  },
  ask: (request) => ipcRenderer.invoke('pet:ask', request),
  approve: (id, action, answer) => ipcRenderer.invoke('pet:approve', { id, action, answer }),
  // 与 DSH 插件联动：读插件写的 live.json，把桌宠上的选择写回 pet-command.json。
  pluginLive: () => ipcRenderer.invoke('pet:plugin:live'),
  pluginCommand: (command) => ipcRenderer.invoke('pet:plugin:command', command),
  reportTask: (task) => ipcRenderer.invoke('pet:reportTask', task),
  // 能力中心要求设置窗切到某面板（例如「记忆」）。
  onSettingsPanel: (callback) => {
    const handler = (_event, panel) => callback(panel)
    ipcRenderer.on('pet:settings:panel', handler)
    return () => ipcRenderer.removeListener('pet:settings:panel', handler)
  },
  // 托盘「设置」→ 渲染层把面板叫回来（C-84 后面板默认收起，需要外部入口）。
  onShowSettings: (handler) => {
    ipcRenderer.on('pet:show-settings', handler)
    return () => ipcRenderer.removeListener('pet:show-settings', handler)
  },
  onDecision: (callback) => {
    const handler = (_event, outcome) => callback(outcome)
    ipcRenderer.on('pet:decision', handler)
    return () => ipcRenderer.removeListener('pet:decision', handler)
  },
  // 主进程广播的窗口生命周期。返回解绑函数，渲染侧销毁时必须调用，
  // 否则换肤 / 重建窗口会累积监听器。
  onLifecycle: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('pet:lifecycle', handler)
    return () => ipcRenderer.removeListener('pet:lifecycle', handler)
  },
  // B 站浏览：搜索 / 详情 / 打开 / 写操作 / 读文章。写操作默认全关，危险动作二次确认。
  biliSearch: (keyword) => ipcRenderer.invoke('pet:bili:search', { keyword }),
  biliVideoInfo: (bvid) => ipcRenderer.invoke('pet:bili:videoInfo', { bvid }),
  biliOpen: (url) => ipcRenderer.invoke('pet:bili:open', { url }),
  biliWrite: (payload) => ipcRenderer.invoke('pet:bili:write', payload),
  biliArticle: (url) => ipcRenderer.invoke('pet:bili:article', { url }),
  biliSubtitleList: (bvid, cid) => ipcRenderer.invoke('pet:bili:subtitleList', { bvid, cid }),
  biliTranscript: (url) => ipcRenderer.invoke('pet:bili:transcript', { url }),
  biliLoginStatus: () => ipcRenderer.invoke('pet:bili:loginStatus'),
  addFacts: (facts, scope) => ipcRenderer.invoke('pet:memory:addFacts', { facts, scope }),
  // 邮件：真发信，收件人默认取设置里的默认收件人，主题正文每次填。
  sendMail: (payload) => ipcRenderer.invoke('pet:mail:send', payload)
})
