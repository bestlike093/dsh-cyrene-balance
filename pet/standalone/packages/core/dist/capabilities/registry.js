/**
 * 能力注册表：哪些默认开着，哪些要用户自己点开。
 *
 * 参照 Cyrene 本体已有的能力清单，把桌宠缺的部分按「风险」而不是按「功能大小」定默认值。
 * 判据很简单：会对外留下痕迹、会消耗资产、会动别人东西的，一律默认关闭。
 *
 * 三种默认状态：
 * - `on`：默认开启，用户想关可以关
 * - `off`：默认关闭，用户点开就能用
 * - `manual`：需要外部依赖，点开前得先配好服务，否则开了也是空转
 *
 * 高风险项（`risk: 'high'`）多一道确认：只在设置里打开不够，
 * 还要在 `acknowledged` 里登记一次，才会真正生效。
 */
export const CAPABILITY_SPECS = [
    // ---- 浏览 ----
    {
        id: 'browse.read',
        label: '读取网页内容',
        group: 'browse',
        defaultState: 'on',
        risk: 'low',
        status: 'live',
        note: '抓取你给的链接正文，不登录、不提交。'
    },
    {
        id: 'browse.browser',
        label: '内置浏览器',
        group: 'browse',
        defaultState: 'off',
        risk: 'medium',
        note: '可以打开页面、点击、填表。等于把鼠标交出去，默认关闭。'
    },
    {
        id: 'browse.bilibili.read',
        label: 'B 站只读',
        group: 'browse',
        defaultState: 'on',
        risk: 'low',
        status: 'live',
        note: '搜索、看简介、看评论、看相关推荐。'
    },
    {
        id: 'browse.bilibili.comment',
        label: 'B 站评论',
        group: 'browse',
        defaultState: 'off',
        risk: 'high',
        status: 'live',
        dependsOn: ['browse.bilibili.read'],
        note: '会公开发言，发出去就代表你。'
    },
    {
        id: 'browse.bilibili.like',
        label: 'B 站点赞',
        group: 'browse',
        defaultState: 'off',
        risk: 'medium',
        status: 'live',
        dependsOn: ['browse.bilibili.read'],
        note: '可以取消，但会留下记录。'
    },
    {
        id: 'browse.bilibili.favorite',
        label: 'B 站收藏',
        group: 'browse',
        defaultState: 'off',
        risk: 'medium',
        status: 'live',
        dependsOn: ['browse.bilibili.read'],
        note: '可以取消，收藏夹默认私密。'
    },
    {
        id: 'browse.bilibili.coin',
        label: 'B 站投币',
        group: 'browse',
        defaultState: 'off',
        risk: 'high',
        status: 'live',
        dependsOn: ['browse.bilibili.read'],
        note: '消耗硬币，投出去退不回来。'
    },
    {
        id: 'browse.bilibili.share',
        label: 'B 站转发',
        group: 'browse',
        defaultState: 'off',
        risk: 'high',
        status: 'live',
        dependsOn: ['browse.bilibili.read'],
        note: '转发到动态，撤不回。'
    },
    {
        id: 'browse.post',
        label: '发动态',
        group: 'browse',
        defaultState: 'off',
        risk: 'high',
        status: 'live',
        note: '对外发布内容，不可撤回。默认关闭。'
    },
    // ---- 媒体 ----
    {
        id: 'media.image',
        label: '图片渲染',
        group: 'media',
        defaultState: 'on',
        risk: 'low',
        status: 'live',
        note: '表情、立绘这类静态素材的显示。'
    },
    {
        id: 'media.live2d',
        label: 'Live2D',
        group: 'media',
        defaultState: 'on',
        risk: 'low',
        status: 'live',
        note: '需要分层源文件，缺素材时自动降级到静态首帧。'
    },
    {
        id: 'media.screenshot',
        label: '截图',
        group: 'media',
        defaultState: 'on',
        risk: 'medium',
        note: '抓当前屏幕，只在本地处理。'
    },
    {
        id: 'media.tts',
        label: '语音合成',
        group: 'media',
        defaultState: 'off',
        risk: 'low',
        status: 'live',
        note: '需要先配好本地语音服务，否则开了也没有声音。'
    },
    {
        id: 'media.music',
        label: '音乐播放',
        group: 'media',
        defaultState: 'off',
        risk: 'low',
        note: '搜索与播放。会占用音频设备。'
    },
    // ---- 社交 ----
    {
        id: 'social.emoji',
        label: '发表情',
        group: 'social',
        defaultState: 'on',
        risk: 'low',
        status: 'live',
        note: '在合适的时候发一张表情。素材已随包提供。'
    },
    {
        id: 'social.voiceMessage',
        label: '发语音消息',
        group: 'social',
        defaultState: 'off',
        risk: 'medium',
        status: 'live',
        dependsOn: ['media.tts'],
        note: '把合成的声音发到聊天里。'
    },
    // ---- 输入输出 ----
    {
        id: 'io.file.read',
        label: '读本地文件',
        group: 'io',
        defaultState: 'on',
        risk: 'medium',
        status: 'live',
        note: '读取你指定的文件。'
    },
    {
        id: 'io.file.write',
        label: '写本地文件',
        group: 'io',
        defaultState: 'off',
        risk: 'high',
        status: 'live',
        note: '写入被限制在指定目录内，重名默认不覆盖。'
    },
    {
        id: 'io.download',
        label: '下载文件',
        group: 'io',
        defaultState: 'off',
        risk: 'medium',
        status: 'live',
        note: '从网络保存文件到本地，先看体积再下。'
    },
    {
        id: 'io.mail.read',
        label: '读邮件',
        group: 'io',
        defaultState: 'off',
        risk: 'medium',
        status: 'live',
        note: '解析头部与正文，附件只报名字和大小。'
    },
    {
        id: 'io.mail.send',
        label: '发邮件',
        group: 'io',
        defaultState: 'off',
        risk: 'high',
        status: 'live',
        dependsOn: ['io.mail.read'],
        note: '拼信由本地完成，以你的名义发出，不可撤回。'
    },
    // ---- agent ----
    {
        id: 'agent.subagent',
        label: '子代理',
        group: 'agent',
        defaultState: 'on',
        risk: 'low',
        status: 'live',
        note: '只读任务可并行，写入任务排队，单任务有步数预算。'
    },
    {
        id: 'agent.mcp',
        label: 'MCP 服务',
        group: 'agent',
        defaultState: 'off',
        risk: 'medium',
        status: 'live',
        note: '配置会先校验，工具名按 server 分命名空间。'
    },
    // ---- 游戏 ----
    {
        id: 'game.daily',
        label: '游戏日常排班',
        group: 'game',
        defaultState: 'on',
        risk: 'medium',
        status: 'live',
        note: '按时间跑日常并汇报结果。不直接操作客户端。'
    },
    {
        id: 'game.clientControl',
        label: '直接操作游戏客户端',
        group: 'game',
        defaultState: 'off',
        risk: 'high',
        dependsOn: ['game.daily'],
        note: '模拟点击与按键，需多次确认，有时间上限。'
    },
    {
        id: 'game.capture',
        label: '游戏画面抓取',
        group: 'game',
        defaultState: 'off',
        risk: 'high',
        dependsOn: ['game.clientControl'],
        note: '跟随客户端操作一起开启，单独开没有意义。'
    }
];
const specById = new Map(CAPABILITY_SPECS.map((spec) => [spec.id, spec]));
export function getCapability(id) {
    return specById.get(id);
}
export function capabilitiesByGroup(group) {
    return CAPABILITY_SPECS.filter((spec) => spec.group === group);
}
/** 默认就该生效的能力 id。只算已经接上的，别把空壳算进来。 */
export function defaultCapabilities() {
    return CAPABILITY_SPECS.filter((spec) => spec.status === 'live' && spec.defaultState === 'on').map((spec) => spec.id);
}
/** 高风险能力 id。设置页需要用它们决定要不要弹确认。 */
export function highRiskCapabilities() {
    return CAPABILITY_SPECS.filter((spec) => spec.risk === 'high').map((spec) => spec.id);
}
/**
 * 解析最终生效的能力集合。
 *
 * 顺序：基线（默认值）→ 用户点开 → 用户关掉 → 高风险确认 → 依赖检查。
 * 依赖检查放在最后，所以「父项被关掉时子项自动失效」，不需要调用方自己算。
 */
export function resolveCapabilities(settings = {}) {
    return resolveFrom(CAPABILITY_SPECS, settings);
}
/**
 * 同一套规则，换一份清单。
 *
 * 测试用它验证「一项既是 live 又高风险」这类真实注册表里还没出现的组合；
 * 将来插件自带能力包，也从这里进来，不必复制一遍解析逻辑。
 */
export function resolveFrom(specs, settings = {}) {
    const byId = new Map(specs.map((spec) => [spec.id, spec]));
    const enabled = new Set(settings.enabled ?? []);
    const disabled = new Set(settings.disabled ?? []);
    const acknowledged = new Set(settings.acknowledged ?? []);
    const unknown = [...new Set([...enabled, ...disabled, ...acknowledged])].filter((id) => !byId.has(id));
    const blocked = [];
    const unavailable = [];
    const candidate = new Set();
    for (const spec of specs) {
        // 还没接上实现的项，无论用户怎么设置都不会生效。
        // 放在最前面判断，避免它们混进 blocked 让用户以为自己点错了。
        if (spec.status !== 'live') {
            unavailable.push(spec.id);
            continue;
        }
        if (disabled.has(spec.id)) {
            blocked.push({ id: spec.id, reason: 'turned-off', detail: '已被用户关闭' });
            continue;
        }
        const userTurnedOn = enabled.has(spec.id);
        if (!userTurnedOn) {
            // 默认关的项没被点开，属于正常状态，不记异常。
            if (spec.defaultState === 'off')
                continue;
            // 需要外部服务的项，没配置前要明确提示出来，不能悄悄跳过。
            if (spec.defaultState === 'manual') {
                blocked.push({ id: spec.id, reason: 'needs-setup', detail: spec.note });
                continue;
            }
        }
        if (spec.risk === 'high' && !acknowledged.has(spec.id)) {
            blocked.push({
                id: spec.id,
                reason: 'not-acknowledged',
                detail: '还差你亲口点一次头呢，这种事人家不敢替你做主'
            });
            continue;
        }
        candidate.add(spec.id);
    }
    // 依赖检查放在最后：父项不在 candidate 里，子项就出局。
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of [...candidate]) {
            const spec = byId.get(id);
            if (spec?.dependsOn === undefined)
                continue;
            const missing = spec.dependsOn.filter((dep) => !candidate.has(dep));
            if (missing.length === 0)
                continue;
            candidate.delete(id);
            blocked.push({
                id,
                reason: 'dependency-missing',
                detail: `依赖未生效：${missing.join('、')}`
            });
            changed = true;
        }
    }
    const blockedIds = new Set(blocked.map((block) => block.id));
    const available = specs
        .filter((spec) => spec.status === 'live' && !candidate.has(spec.id) && !blockedIds.has(spec.id))
        .map((spec) => spec.id);
    return {
        active: specs.filter((spec) => candidate.has(spec.id)).map((spec) => spec.id),
        total: specs.length,
        blocked,
        unavailable,
        available,
        unknown
    };
}
export function isCapabilityActive(id, resolution) {
    return resolution.active.includes(id);
}
/** 压成一句话，给设置页顶部的概览用。 */
export function describeResolution(resolution) {
    const on = resolution.active.length;
    const total = resolution.total;
    const parts = [`${on} / ${total} 项可用`];
    if (resolution.unavailable.length > 0) {
        parts.push(`${resolution.unavailable.length} 项还没接上`);
    }
    if (resolution.blocked.length > 0) {
        parts.push(`${resolution.blocked.length} 项被你关着或卡在确认`);
    }
    if (resolution.unknown.length > 0) {
        parts.push(`${resolution.unknown.length} 项不认识`);
    }
    return parts.join('，');
}
