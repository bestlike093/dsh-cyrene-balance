import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAffinity } from '../affinity.mjs'

function memoryAffinity() {
  let now = 1_000_000
  const affinity = createAffinity({ now: () => now })
  return { affinity, tick: (ms = 1_000) => (now += ms) }
}

describe('createAffinity 手动调整', () => {
  it('初始未锁定，也没有手动记录', () => {
    const { affinity } = memoryAffinity()
    expect(affinity.snapshot()).toMatchObject({
      favor: 0,
      locked: false,
      manualLogCount: 0,
      manualLog: []
    })
  })

  it('设定好感会留一条记录，按时间倒序返回', () => {
    const { affinity, tick } = memoryAffinity()
    affinity.setFavor(30, { note: '第一次调' })
    tick()
    affinity.setFavor(72, { note: '第二次调' })

    const snapshot = affinity.snapshot()
    expect(snapshot.favor).toBe(72)
    expect(snapshot.manualLogCount).toBe(2)
    expect(snapshot.manualLog[0]).toMatchObject({ before: 30, after: 72, delta: 42 })
    expect(snapshot.manualLog[1]).toMatchObject({ before: 0, after: 30, delta: 30 })
  })

  it('越界会夹到 0–100，非法值不会把好感清零', () => {
    const { affinity } = memoryAffinity()
    expect(affinity.setFavor(150).favor).toBe(100)
    expect(affinity.setFavor(-20).favor).toBe(0)
    affinity.setFavor(48)
    expect(affinity.setFavor('不是数字').favor).toBe(48)
    expect(affinity.setFavor(null).favor).toBe(48)
  })

  it('增减按差值记录，零和非法值不写日志', () => {
    const { affinity } = memoryAffinity()
    affinity.setFavor(40)
    affinity.adjustFavor(15, { note: '更亲近一点' })
    affinity.adjustFavor(-60, { note: '降回去' })
    affinity.adjustFavor(0)
    affinity.adjustFavor('x')

    const snapshot = affinity.snapshot()
    expect(snapshot.favor).toBe(0)
    expect(snapshot.manualLogCount).toBe(3)
    expect(snapshot.manualLog[0]).toMatchObject({ before: 55, after: 0, delta: -55 })
  })

  it('手动记录最多保留 50 条', () => {
    const { affinity, tick } = memoryAffinity()
    for (let index = 1; index <= 60; index += 1) {
      affinity.setFavor(index)
      tick(10)
    }
    expect(affinity.snapshot().manualLogCount).toBe(50)
    expect(affinity.snapshot().manualLog[0].after).toBe(60)
  })
})

describe('createAffinity 锁定', () => {
  it('锁住后模型评估不改好感，印象与关系照常更新', () => {
    const { affinity } = memoryAffinity()
    affinity.setFavor(66)
    affinity.setLocked(true)

    const snapshot = affinity.applyEvaluation({
      favor: 5,
      impression: '说话很直接',
      relation: '会一起改代码'
    })

    expect(snapshot.favor).toBe(66)
    expect(snapshot.locked).toBe(true)
    expect(snapshot.impression).toBe('说话很直接')
    expect(snapshot.relation).toBe('会一起改代码')
  })

  it('未锁定时评估正常改好感', () => {
    const { affinity } = memoryAffinity()
    affinity.setFavor(20)
    expect(affinity.applyEvaluation({ favor: 58 }).favor).toBe(58)
  })

  it('锁住时仍然可以手动改，改完还是锁定状态', () => {
    const { affinity } = memoryAffinity()
    affinity.setLocked(true)
    affinity.setFavor(88)
    expect(affinity.snapshot()).toMatchObject({ favor: 88, locked: true })
    affinity.setLocked(false)
    expect(affinity.snapshot().locked).toBe(false)
  })

  it('作用域互不影响', () => {
    const { affinity } = memoryAffinity()
    affinity.setFavor(70, { scope: 'desktop' })
    affinity.setLocked(true, { scope: 'desktop' })
    affinity.setFavor(12, { scope: 'qq:group:1' })

    expect(affinity.snapshot('desktop')).toMatchObject({ favor: 70, locked: true })
    expect(affinity.snapshot('qq:group:1')).toMatchObject({ favor: 12, locked: false })
  })
})

describe('createAffinity 数据迁移', () => {
  it('旧文件补 schemaVersion 与默认字段，落盘前留 .bak', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'affinity-'))
    const file = path.join(dir, 'affinity.json')
    const legacy = {
      version: 2,
      scopes: {
        desktop: {
          favor: 63,
          impression: '记得旧版本',
          relation: '一起做过桌宠',
          turns: 12,
          updatedAt: 111
        }
      }
    }
    await fs.writeFile(file, JSON.stringify(legacy), 'utf8')

    const affinity = createAffinity({ file })
    await affinity.ready()
    expect(affinity.snapshot('desktop')).toMatchObject({
      favor: 63,
      impression: '记得旧版本',
      locked: false,
      manualLogCount: 0
    })

    affinity.setFavor(80, { note: '迁移后调整' })
    await affinity.flush()

    const saved = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(saved.schemaVersion).toBe(2)
    expect(saved.scopes.desktop).toMatchObject({
      favor: 80,
      impression: '记得旧版本',
      locked: false
    })
    expect(saved.scopes.desktop.manualLog).toHaveLength(1)

    const backup = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))
    expect(backup.scopes.desktop.favor).toBe(63)
  })

  it('再次读取新版文件不会重复写 .bak', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'affinity-'))
    const file = path.join(dir, 'affinity.json')
    await fs.writeFile(
      file,
      JSON.stringify({ schemaVersion: 2, version: 2, scopes: { desktop: { favor: 10 } } }),
      'utf8'
    )

    const first = createAffinity({ file })
    await first.ready()
    first.setFavor(20)
    await first.flush()
    await expect(fs.access(`${file}.bak`)).rejects.toThrow()

    const second = createAffinity({ file })
    await second.ready()
    second.setFavor(30)
    await second.flush()
    await expect(fs.access(`${file}.bak`)).rejects.toThrow()
  })
})
