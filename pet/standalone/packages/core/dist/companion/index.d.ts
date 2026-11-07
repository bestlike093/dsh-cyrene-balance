/**
 * 陪伴层：心情、断言记忆、反思、表情选择，以及把它们串成一轮对话的核心。
 *
 * 这些模块只做纯逻辑，不碰文件系统、不发网络请求，
 * 因此可以安全地从 `@pet/core/browser` 导出，也能在离线测试里单独跑。
 */
export * from './mood.js';
export * from './body.js';
export * from './agenda.js';
export * from './lifestyle.js';
export * from './candidates.js';
export * from './openingLedger.js';
export * from './assertions.js';
export * from './reflection.js';
export * from './emojiPicker.js';
export * from './companionCore.js';
