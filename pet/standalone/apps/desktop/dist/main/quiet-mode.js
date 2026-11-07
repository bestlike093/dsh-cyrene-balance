// 夜间不扰判定：实现已搬到 @pet/shared，主进程、渲染层与语音共用同一份。
//
// 保留这个模块作为主进程的稳定入口（main.mjs 从这里 import），
// 避免判定逻辑出现第二份实现。
export { isPresenceQuietNow as isQuietNow, presenceQuietModeAt as quietModeAt } from '@pet/shared';
