/**
 * 三端口共用的调用链骨架（S7-b）。
 *
 * push 的唯一出口是 `publish()`：
 * - `apply()` 校验通过后只调用 `publish()` 一次，不再调 `broadcast()`；
 * - `broadcast()` 只是「手动再发一次全量」的入口，内部转调 `publish()`。
 *
 * 任何一条绕开 `publish()` 的推送路径都会让「换一次主题推两遍」重新出现，
 * 因此测试断言的是 publish 的调用次数，不是订阅端收到了几次。
 */
import { ErrorCode, PetError } from '@pet/shared';
export class PresentationPortBase {
    publisher;
    logPublish;
    registry = new Map();
    currentValue;
    /** 换肤事务：一次 apply / broadcast 一个标识，用来区分「一次发多次」与「多次各发一次」。 */
    transaction = 'standalone';
    seq = 0;
    constructor(publisher, 
    /** 默认不打印；需要取证时由装配方注入，避免污染测试输出。 */
    logPublish = () => { }) {
        this.publisher = publisher;
        this.logPublish = logPublish;
    }
    /** 供 describeTokens 使用：未 apply 时返回 undefined，而不是抛错。 */
    currentOrUndefined() {
        return this.currentValue;
    }
    async publish(patch) {
        this.logPublish(`publish tx=${this.transaction} keys=${Object.keys(patch).length}`);
        await this.publisher.publish(patch);
    }
    async broadcast() {
        this.transaction = `broadcast-${++this.seq}`;
        await this.publish(this.toPatch(this.requireCurrent()));
    }
    async apply(value) {
        this.assertValid(value);
        this.currentValue = value;
        this.transaction = `apply-${++this.seq}`;
        await this.publish(this.toPatch(value));
    }
    async register(value) {
        this.assertValid(value);
        this.registry.set(value.id, value);
    }
    async unregister(id) {
        this.registry.delete(id);
    }
    list() {
        return [...this.registry.values()];
    }
    current() {
        return this.requireCurrent();
    }
    assertValid(value) {
        const result = this.validate(value);
        if (!result.ok) {
            throw new PetError(ErrorCode.INVALID_ARGUMENT, '表现层配置校验失败', {
                details: { errors: result.errors }
            });
        }
    }
    requireCurrent() {
        if (this.currentValue === undefined) {
            throw new PetError(ErrorCode.NOT_REGISTERED, '尚未应用任何配置');
        }
        return this.currentValue;
    }
}
