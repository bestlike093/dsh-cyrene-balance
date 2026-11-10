import { ErrorCode, PetError } from '@pet/shared';
/** 主进程↔渲染进程唯一允许的通道清单。新增能力必须同时改这里和 preload。 */
export const IPC_CHANNELS = [
    'pet:ask',
    'pet:approve',
    'pet:speech:list',
    'pet:speech:resolve',
    'pet:speech:learning',
    'pet:plugin:live',
    'pet:plugin:command',
    'pet:reportTask',
    'pet:settings:get',
    'pet:settings:save',
    'pet:settings:open',
    'pet:settings:close',
    'pet:settings:minimize',
    'pet:settings:toggleMaximize',
    // 恢复出厂：写默认设置、清记忆与聊天记录、移除服务密钥，然后重启回引导页。
    'pet:factory:reset',
    'pet:qq:test',
    // QQ 运行状态：连接态、待发队列与 webhook 监听结果，只读。
    'pet:qq:status',
    // 一键绑定：把最近一条入站消息的发送者写进主人名单，会落盘并重建通道。
    'pet:qq:bind-owner',
    'pet:window:setClickThrough',
    // 像素级穿透：渲染层命中判断后切换可点/穿透，只接受 true/false。
    'pet:window:setPixelHit',
    'pet:window:setAlwaysOnTop',
    'pet:window:move',
    'pet:window:applySize',
    'pet:window:getSize',
    'pet:window:dragStart',
    'pet:window:dragEnd',
    'pet:render:report',
    'pet:render:info',
    'pet:diagnostics:collect',
    'pet:models:list',
    'pet:models:active',
    'pet:models:import',
    'pet:models:setActive',
    'pet:models:openFolder',
    'pet:balance:query',
    // 余额告警确认：气泡上的「知道了」只写 ack，不改账本。
    'pet:balance:ack',
    // 人格问卷：渲染进程取题库、交答案算分、落结果；量表只在 companion 里维护一份。
    'pet:assessment:schema',
    'pet:assessment:score',
    'pet:assessment:save',
    'pet:menu:context',
    // 记忆观察台入口在设置里，窗口由主进程开。
    'pet:memory:open',
    'pet:vault:diagnose',
    'pet:vault:export',
    'pet:vault:import',
    'pet:vault:rotate',
    'pet:backup:getConfig',
    'pet:backup:chooseDir',
    'pet:backup:setKeep',
    'pet:backup:run',
    // 自动备份：开关与间隔；口令由主进程用系统密钥加密保存。
    'pet:backup:setAuto',
    'pet:backup:findLatest',
    // 备份锁探针：只给主进程诊断与测试读锁状态，不暴露渲染。
    'pet:backup:probe',
    'pet:secrets:set',
    'pet:secrets:masked',
    'pet:secrets:clear',
    'pet:voice:speak',
    'pet:voice:status',
    // 语音输入：状态 / 配置 / 保存 / 麦克风开关 / 转写 / 本机服务。
    // 这几个通道在上线时漏登记，窗口一启动就抛 PERMISSION_DENIED，整窗起不来。
    'pet:asr:status',
    'pet:asr:config',
    'pet:asr:save',
    'pet:asr:mic',
    'pet:asr:transcribe',
    'pet:asr:local',
    'pet:chat:send',
    'pet:chat:history',
    'pet:chat:status',
    'pet:chat:clear',
    'pet:chat:export',
    'pet:chat:open',
    'pet:chat:close',
    // 拍照：拍的是她自己，只回文件路径，不把图像数据搬进渲染层。
    'pet:photo:take',
    'pet:memory:stats',
    'pet:memory:facts',
    'pet:memory:facts:remove',
    'pet:memory:facts:update',
    // 她记住的事整份备份：JSONL 一行一条，导出后可原样导入。
    'pet:memory:facts:export',
    'pet:memory:facts:import',
    // 学习闭环落库口：把 kind=knowledge 写进结构化记忆。
    'pet:memory:addFacts',
    'pet:memory:list',
    'pet:memory:delete',
    // 钉子：钉住的记忆不降温、不自动归档。
    'pet:memory:pin',
    'pet:memory:export',
    'pet:memory:clear',
    // 启动前体检：模型 / 密钥 / 语音配置 / 磁盘 / Vault，一次汇总。
    'pet:preflight',
    // 运行状态四卡片：QQ / 记忆条数 / 今天主动次数 / 上次反思，只读。
    'pet:status:summary',
    // 每日巡视与反思：手动触发一次日报 / 生成三行反思。
    'pet:daily:run',
    'pet:daily:last',
    'pet:reflection:run',
    // 主动台词：被点一下 / 设置页试一句。
    'pet:presence:speak',
    // 能力中心：独立窗口入口；猜拳战绩只留内存，重启即清。
    'pet:ability:open',
    // 游戏页：排班与记录从设置窗独立出来后的入口。
    'pet:game:open',
    'pet:game:rps',
    // 游戏日常：检测 + 排班读写 + dry-run 预览；真实执行器另开一期。
    'pet:game:detect',
    'pet:game:schedule:get',
    'pet:game:schedule:save',
    'pet:game:dry-run',
    // 多游戏日常：state 读写、计划预览、注册/删除计划任务、运行记录。
    'pet:game:daily:state',
    'pet:game:daily:update',
    'pet:game:daily:plan',
    'pet:game:daily:apply',
    'pet:game:daily:query',
    'pet:game:daily:disable',
    'pet:game:daily:runs',
    // 游戏助手：默认关闭；连续两次风险确认后才允许生成任务计划。
    'pet:game:assistant:status',
    'pet:game:assistant:confirm',
    'pet:game:assistant:disable',
    'pet:game:assistant:record',
    'pet:game:assistant:claim',
    'pet:game:assistant:rank',
    'pet:game:assistant:plan',
    // 随包素材清单（表情 / 立绘），只回相对路径与 pet-media 地址。
    'pet:assets:list',
    // 素材包：用户导入的字体 / 图标 / 气泡 / 表情，存 userData/packs。
    'pet:packs:list',
    'pet:packs:import',
    'pet:packs:remove',
    'pet:packs:setEnabled',
    // 聊天页背景：只弹系统选择框挑一张本机图片，复制进 userData/backgrounds。
    'pet:background:list',
    'pet:background:pick',
    'pet:background:clear',
    // 背景库独立页：按 id 选用 / 删除，以及从设置窗打开这一页。
    'pet:background:apply',
    'pet:background:remove',
    'pet:background:open',
    // 背景五槽：读各槽当前用的图，以及单独设定某个槽（id 空 = 该槽不用背景）。
    'pet:background:slots',
    'pet:background:slot:set',
    // 会话页：聊天历史与 QQ 会话放在同一个窗口里看。
    'pet:sessions:open',
    'pet:qq:conversations',
    // 表情包：QQ 偷来的图先进待审核队列，入库 / 丢弃只能由用户点。
    'pet:sticker:inbox',
    'pet:sticker:library',
    'pet:sticker:approve',
    'pet:sticker:reject',
    'pet:sticker:open',
    'pet:sticker:send',
    'pet:persona:preview',
    // 桌面状态条的系统指标：只读快照，主进程按固定间隔采样后推送。
    'pet:system:stats',
    // 心情快照：按当前时间与会话时长算，只回标签与等级。
    'pet:presence:mood',
    // 今天的节目单：只读「现在 / 接下来」，以及手动顺延这一个写动作。
    'pet:companion:agenda',
    'pet:companion:agenda:reschedule',
    // 观察台：整份只读快照，外加三个只落在单个会话上的手动动作。
    'pet:insight:open',
    'pet:insight:snapshot',
    'pet:insight:set-favor',
    'pet:insight:adjust-favor',
    'pet:insight:lock-favor',
    'pet:insight:reset-scope',
    'pet:insight:delete-memory',
    // 观察台的两个会话级开关：贴近时刻与摩擦强度，都只写单个会话。
    'pet:insight:set-intimacy',
    'pet:insight:set-friction',
    // 参考音频：只弹系统选择框挑本机音频，回绝对路径；不读文件内容。
    'pet:voice:pickRefAudio',
    // 语音唤醒：运行时按需下载（默认关闭）。只装/卸/开关/看状态，不搬运音频。
    'pet:wake:status',
    'pet:wake:install',
    'pet:wake:remove',
    'pet:wake:setEnabled',
    // 连接自检：用已存的 Key 发一次最小请求，只回状态与耗时，不回密钥。
    'pet:llm:test',
    // 设置同步：导出快照 / 应用对端变更，只在本机同步目录里搬运。
    'pet:sync:run',
    // 同步目录查询与切换：不动云端数据，只改本机偏好。
    'pet:sync:info',
    'pet:sync:chooseDir',
    // 同步口令：只用于给同步包里的敏感字段加密，明文不落盘、不进包。
    'pet:sync:setPassphrase',
    'pet:sync:clearPassphrase',
    'pet:sync:passphraseStatus',
    // B 站与邮件：能力中心的两个真入口。写操作默认全关，投币上限 2 枚。
    'pet:bili:search',
    'pet:bili:videoInfo',
    'pet:bili:open',
    'pet:bili:write',
    'pet:bili:article',
    // 字幕取稿与登录态：学习闭环读字幕全文，登录态只读。
    'pet:bili:subtitleList',
    'pet:bili:transcript',
    'pet:bili:loginStatus',
    'pet:mail:send'
];
const ALLOWED = new Set(IPC_CHANNELS);
export function isAllowedChannel(channel) {
    return ALLOWED.has(channel);
}
/** 白名单外一律 PERMISSION_DENIED，不区分「拼错」和「越权」。 */
export function assertChannel(channel) {
    if (!ALLOWED.has(channel)) {
        throw new PetError(ErrorCode.PERMISSION_DENIED, `IPC 通道未授权：${channel}`, {
            details: { channel }
        });
    }
}
/** 通道路由：只接受已注册 + 白名单内的调用，其余给稳定错误码。 */
export class IpcRouter {
    handlers = new Map();
    handle(channel, handler) {
        this.handlers.set(channel, handler);
        return () => {
            if (this.handlers.get(channel) === handler)
                this.handlers.delete(channel);
        };
    }
    async invoke(request) {
        assertChannel(request.channel);
        const handler = this.handlers.get(request.channel);
        if (handler === undefined) {
            throw new PetError(ErrorCode.NOT_SUPPORTED, `通道没有处理器：${request.channel}`);
        }
        return handler(request.payload);
    }
    channels() {
        return [...this.handlers.keys()];
    }
}
