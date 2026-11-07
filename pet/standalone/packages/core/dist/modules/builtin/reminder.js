import { ErrorCode, PetError } from '@pet/shared';
export const REMINDER_KEY = 'reminder.lastBoot';
/** 提醒模块：演示记忆读写，卸载时不删除历史。 */
export const reminderModule = {
    meta: {
        id: 'builtin.reminder',
        name: '提醒',
        version: '1.0.0',
        permissions: ['memory.read', 'memory.write'],
        // 一般模块：开关由用户自行决定，不额外确认
        tier: 'general'
    },
    async bootstrap(ctx) {
        const sandbox = ctx;
        const memory = sandbox.api.memory;
        if (memory?.write === undefined) {
            throw new PetError(ErrorCode.PERMISSION_DENIED, '提醒模块缺少 memory.write');
        }
        const previous = memory.read === undefined ? null : await memory.read(REMINDER_KEY);
        await memory.write(REMINDER_KEY, {
            at: Date.now(),
            previous
        });
    },
    async teardown() {
        // 记忆由用户数据层保留，不做删除
    }
};
