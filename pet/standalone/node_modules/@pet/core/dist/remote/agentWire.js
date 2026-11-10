import { applyIncomingMessage } from './ownerPolicy.js';
export const DEFAULT_ERROR_REPLY = '刚刚没想明白，等下再试一次好不好？';
export class AgentWire {
    gate;
    policy;
    runner;
    reply;
    onError;
    constructor(options) {
        this.gate = options.gate;
        this.policy = options.policy;
        this.runner = options.runner;
        this.reply = options.reply;
        this.onError = options.onError ?? (() => DEFAULT_ERROR_REPLY);
    }
    /**
     * 处理一条消息。
     *
     * 顺序是刻意的：先按身份提权，再检查空闲降权。
     * 反过来的话，主人隔了五分钟开口，会先被降权再提权，
     * 中途那一瞬间的工具面是错的，而且审计里会多出一条假的切换。
     */
    async handle(message) {
        applyIncomingMessage(this.gate, this.policy, message);
        this.gate.tick();
        const isOwner = this.policy.isOwner(message);
        let reply;
        try {
            reply = await this.runner.run({
                mode: this.gate.mode,
                text: message.text,
                isOwner
            });
        }
        catch (error) {
            reply = { text: this.onError(error, message) };
        }
        await this.reply(reply.text);
        return reply;
    }
    /** 宿主定时调用，只做空闲降权。返回 true 表示这一轮收权了。 */
    tick(now) {
        return this.gate.tick(now);
    }
}
