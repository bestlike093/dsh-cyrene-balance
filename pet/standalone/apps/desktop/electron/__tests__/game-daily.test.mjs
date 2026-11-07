import { describe, expect, it, vi } from 'vitest'
import { createGameDailyService } from '../game-daily.mjs'

const NOW = new Date('2026-11-02T18:00:00+08:00').getTime()

function service(overrides = {}) {
  return createGameDailyService({
    filePath: 'C:\\tmp\\game-daily.json',
    now: () => NOW,
    ...overrides
  })
}

describe('游戏日常宿主层', () => {
  it('配置不存在时返回默认值，模式锁定 dry', async () => {
    const readFile = vi.fn(async () => {
      const error = new Error('missing')
      error.code = 'ENOENT'
      throw error
    })
    const result = await service({ readFile }).load()

    expect(result.error).toBeNull()
    expect(result.config).toMatchObject({
      game: 'genshin',
      time: '04:00',
      days: [],
      timeoutMinutes: 150,
      mode: 'dry'
    })
  })

  it('保存时把 real 降级成 dry，写入的也是 dry', async () => {
    let stored = null
    const writeConfig = vi.fn(async (_file, config) => {
      stored = config
    })
    const result = await service({ writeConfig }).save({
      game: 'starrail',
      time: '09:30',
      timeoutMinutes: 45,
      mode: 'real'
    })

    expect(result.ok).toBe(true)
    expect(result.config.mode).toBe('dry')
    expect(stored.mode).toBe('dry')
    expect(stored.timeoutMinutes).toBe(45)
  })

  it('非法排班不写盘，一次返回全部问题', async () => {
    const writeConfig = vi.fn()
    const result = await service({ writeConfig }).save({ time: '25:00', timeoutMinutes: 1 })

    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['time', 'timeoutMinutes'])
    )
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('检测能同时找到 BetterGI 和游戏本体', () => {
    const exists = vi.fn(
      (candidate) =>
        candidate.endsWith('BetterGI.exe') || candidate.endsWith('YuanShen.exe')
    )
    const detected = service({ exists }).detect()

    expect(detected.bettergi.path).toContain('BetterGI.exe')
    expect(detected.games.genshin.path).toContain('YuanShen.exe')
    expect(detected.games.starrail.path).toBeNull()
  })

  it('dry-run 只预览：任务规格、下一次时间、依赖与风险都齐', () => {
    const result = service({ exists: () => false }).dryRun({
      game: 'genshin',
      time: '04:00',
      days: [1, 3],
      timeoutMinutes: 150
    })

    expect(result.ok).toBe(true)
    expect(result.config.mode).toBe('dry')
    expect(result.spec).toMatchObject({
      name: 'game-daily-genshin',
      time: '04:00',
      days: [1, 3],
      executionLimitMinutes: 160,
      mode: 'dry'
    })
    expect(result.nextRunAt).toBeGreaterThan(NOW)
    expect(result.preview).toContain('周一、周三 04:00')
    expect(result.preview).toContain('演练')
    expect(result.risk).toContain('不会启动')
    expect(result.dependencies.blocking.map((item) => item.id)).not.toContain('dsh-cli')
    expect(result.dependencies.items.find((item) => item.id === 'dsh-cli')?.required).toBe(false)
  })

  it('dry-run 收到 real 也按 dry 出预览', () => {
    const result = service({ exists: () => false }).dryRun({ mode: 'real', time: '04:00' })

    expect(result.ok).toBe(true)
    expect(result.config.mode).toBe('dry')
    expect(result.spec.mode).toBe('dry')
  })

  it('配置解析失败时回默认值，并把原因交给界面', async () => {
    const result = await service({ readFile: async () => '{bad' }).load()

    expect(result.error).toBe('read-failed')
    expect(result.config.mode).toBe('dry')
  })
})
