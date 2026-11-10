export const DEFAULT_SETTINGS = {
    schemaVersion: 2,
    // 默认留空：昵称由使用者自己填，安装包里不带任何具体人的名字。
    nickname: '',
    onboarded: false,
    uiMode: 'pet',
    renderMode: 'embedded',
    profile: 'vertical',
    window: { scale: 0.7, alwaysOnTop: true, edgeSnap: true, edgeSnapDistance: 12 },
    bubble: {
        mode: 'rotate',
        fontSize: 14.5,
        radius: 10,
        alpha: 0.92,
        // 300 宽在 340 左右的桌宠窗口里留出两侧呼吸位，长句自动折行。
        width: 300,
        height: 200,
        padding: 14,
        lineHeight: 1.5,
        // 空串 = 用内置字体栈，跟着系统语言走。
        fontFamily: '',
        stickerSize: 64,
        // 空串 = 不加底图，保持纯 CSS 外观。
        background: '',
        backgroundSlice: 12,
        /* 气泡停留秒数：holdSeconds 管台词/余额这类普通气泡，
           noticeHoldSeconds 管系统提示。sanitizeSettingsPatch 的写入白名单
           就是从这份默认值表生成的，这里不登记，设置窗保存时会被静默丢弃。 */
        holdSeconds: 8,
        noticeHoldSeconds: 10
    },
    icon: { tray: '', app: '' },
    sticker: { source: '', autoApprove: true },
    askHandling: 'pet-all',
    askEveryMinutes: 0,
    poseEverySeconds: 60,
    soundLevel: 0.5,
    voice: {
        enabled: false,
        trigger: 'proactive',
        quietHours: { enabled: true, start: '22:00', end: '08:00' },
        provider: 'local',
        // 与本机 IndexTTS v2 服务一致；也兼容 GPT-SoVITS 的默认端口。
        localUrl: 'http://127.0.0.1:9880',
        // 本机服务按 GPT-SoVITS 协议收参数，通用接口才需要改成 generic。
        localProtocol: 'gpt-sovits',
        // 参考音频要使用者自己指定，空着时本地合成会被跳过而不是报错。
        refAudioPath: '',
        // GPT-SoVITS 参考音频对应的文字（prompt_text）：空着不提交，音色会差一截。
        promptText: '',
        promptLang: 'zh',
        cloud: { baseUrl: '', voice: '' },
        volume: 1,
        // 一条气泡话通常几十字，超过就不念了，避免长段独白。
        maxChars: 60,
        // 自动开口之间至少隔 8 秒，防止连续刷屏。
        minIntervalSeconds: 8,
        // 「DSH 语音」四个场景，各自独立勾选；全部默认关。
        // reply 开＝每条回复都念；只勾 wakeWord 时，只在喊语音唤醒词的那一轮念。
        dshScenes: { reply: false, wakeWord: false, autonomous: false, moments: false },
        // 语音唤醒词：只管「要不要出声」，和文字唤醒（能不能接话）分开两份。
        // 留空用内置的语音默认词，不跟顶层的 wakeWords 共用。
        voiceWakeWords: [],
        // 旧字段：迁移时读它决定 reply 初值，之后不再写。
        readDsh: false
    },
    locale: 'zh-CN',
    // 空表示用内置唤醒词，避免默认值散落在 shared 与 electron 两处。
    wakeWords: [],
    companion: {
        // 记忆默认开：纯本地、加密落盘，不出网也不依赖 Key——
        // 默认装好就能记住，才算「陪伴」；聊天仍默认关（要 Key 才出网）。
        memory: {
            enabled: true,
            maxItems: 500,
            summarizeEvery: 8,
            // auto：填了地址走 OpenAI 兼容，没填探本地 Ollama，都不通就纯 BM25。
            embedding: { provider: 'auto', baseUrl: '', model: '', timeoutMs: 1_500 }
        },
        chat: {
            enabled: false,
            provider: 'deepseek',
            model: 'deepseek-chat',
            maxTokens: 800,
            temperature: 0.8,
            historyLimit: 10
        },
        persona: { enabled: true, extraPrompt: '', sections: {} },
        care: {
            // 陪伴任务默认关。
            dailyReview: { enabled: false, at: '22:30' }
        },
        // 身体层默认开：只影响语气，不向外暴露数值。
        body: {
            enabled: true,
            sleepWindow: { start: '23:30', end: '07:30' },
            cycle: { enabled: false, lastStart: '' }
        },
        // 贴近时刻默认关：打开了也只在桌面本机、有由头的时候偶尔出现。
        intimacy: { enabled: false, perDay: 2, cooldownHours: 6, idleHours: 6, aftercareMinutes: 120 }
    },
    presence: {
        // 关着时不请求天气、不请求模型，气泡只用本地台词池。
        aiEnabled: false,
        intervalMinutes: 45,
        // 留空 = 用 presence.mjs 里的默认城市，不在配置里替使用者选地方。
        city: '',
        useWeather: true,
        // 默认开启：23:00–08:00 只关搭话、保留定时提醒。
        quiet: { enabled: true, from: '23:00', to: '08:00', mode: 'urgentOnly', hideHud: false },
        // 三条闸的默认值：一天最多 8 次，连着 7 天没互动就不再主动开口。
        dailyCap: 8,
        silenceDays: 7,
        // 立绘描边默认白边：浅色桌面也要看得清轮廓。
        outline: 'light',
        // 识屏默认关：没问过也不读，拒绝过一次也不会偷偷打开。
        screen: { enabled: false, consentAsked: false }
    },
    // 余额监控默认关；参数先给保守值，打开模块后才生效。
    balance: { threshold: 20, intervalMinutes: 30 },
    // 邮件：默认收件人 + 桌宠自带 SMTP（独立于 Cyrene 本体的 app-settings.json）。
    // smtp.pass 存授权码/密码，明文写在本机 settings.json，与 Cyrene 本体 app-settings.json 做法一致。
    mail: { defaultRecipient: '', fromName: '昔涟', smtp: { host: '', port: 465, user: '', pass: '' } },
    // 浏览（B站）：写操作默认全关，需在能力中心逐个开启；单次投币上限 2。
    browse: { enabledWrites: [], maxCoinsPerAction: 2 },
    showHud: false,
    hudName: '昔涟',
    hudDetail: 'full',
    hudAlpha: 0.9,
    hudScale: 1,
    hudFontScale: 1,
    channels: {
        qq: {
            enabled: false,
            transport: 'gateway',
            appId: '',
            credentialRef: 'vault:qq-token',
            ownerOpenIds: [],
            targetOpenId: '',
            publicKey: '',
            webhookPort: 8787,
            imitateFormat: true
        }
    },
    // 默认樱粉：这是昔涟自己的色调，也是新安装第一眼看到的配色。
    theme: { preset: 'SakuraPink', custom: {} },
    modules: {
        // 三个内置模块的默认开关。宿主启动时按这里的 enabled 决定是否 bootstrap。
        // balance 默认关：它要外网 + API Key，首次启动就发请求会让「装完能不能跑」
        // 的验证被网络噪音干扰，也避免用户在不知情时产生外部请求。
        'builtin.bubble': { enabled: true, permissions: ['ui.render'] },
        'builtin.reminder': { enabled: true, permissions: ['memory.read', 'memory.write'] },
        'builtin.balance': { enabled: false, permissions: ['net.egress'] }
    },
    defaultEmotion: 'neutral',
    // 空串 = 还没导入模型。首次启动时桌宠会显示「导入本地模型」引导。
    live2dModelId: ''
};
