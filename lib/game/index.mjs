/**
 * 游戏能力总入口。
 *
 * 全部模块只接收注入参数（stateDir / filePath / drives / readFile / writeFile），
 * 不读 Electron、不写死盘符，桌面版与 DSH 版共用同一份实现。
 */
export * from './dailySchedule.mjs'
export * from './dailyState.mjs'
export * from './taskRegistration.mjs'
export * from './dailyReport.mjs'
export * from './dependencyCheck.mjs'
export * from './installPaths.mjs'
export * from './launchPlan.mjs'
export * from './gameAssistant.mjs'
export * from './game-daily.mjs'
export * from './game-daily-store.mjs'
export * from './game-daily-scheduler.mjs'
export * from './game-daily-runner.mjs'
export * from './game-assistant.mjs'
