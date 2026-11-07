import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { it } from 'vitest'

import {
  DEFAULT_SLEEP_WINDOW,
  createBodyService,
  describeBody,
  freshState,
  toMinute
} from '../body-state.mjs'

async function tempBodyFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyrene-body-'))
  return { dir, file: path.join(dir, 'body.json') }
}

it('适配层保持原来的导出面', () => {
  assert.equal(toMinute('23:30'), 1410)
  assert.equal(DEFAULT_SLEEP_WINDOW.start, '23:30')
  assert.ok(describeBody(freshState(0)).length >= 0)
})

it('缺文件时从默认值开始，tick 后能落盘', async () => {
  const { dir, file } = await tempBodyFile()
  const start = new Date(2026, 0, 5, 9, 0).getTime()

  const service = createBodyService({ file, now: () => start })
  const snapshot = await service.tick(start + 2 * 3600_000)
  assert.ok(snapshot.energy < 78)
  await service.flush()

  const saved = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(saved.version, 1)
  assert.equal(typeof saved.energy, 'number')
  assert.equal(typeof saved.hunger, 'number')
  assert.equal(typeof saved.socialEnergy, 'number')
  assert.equal('flags' in saved, false)
  assert.equal('asleep' in saved, false)

  await fs.rm(dir, { recursive: true, force: true })
})

it('读回后把关机那段时间补算掉', async () => {
  const { dir, file } = await tempBodyFile()
  const start = new Date(2026, 0, 5, 9, 0).getTime()

  const first = createBodyService({ file, now: () => start })
  const before = await first.tick(start + 2 * 3600_000)
  await first.flush()

  const later = start + 3 * 3600_000
  const second = createBodyService({ file, now: () => later })
  await second.ready()
  const after = second.snapshot()

  assert.ok(after.energy < before.energy)
  assert.equal(after.updatedAt, later)

  await fs.rm(dir, { recursive: true, force: true })
})

it('文件损坏时不让整层起不来', async () => {
  const { dir, file } = await tempBodyFile()
  await fs.writeFile(file, '{ not json', 'utf8')
  const messages = []

  const service = createBodyService({
    file,
    now: () => new Date(2026, 0, 5, 9, 0).getTime(),
    log: (message) => messages.push(message)
  })
  const snapshot = await service.tick()
  assert.equal(typeof snapshot.energy, 'number')
  assert.ok(messages.length > 0)

  await fs.rm(dir, { recursive: true, force: true })
})

it('同一时刻重复推进不会重复扣', async () => {
  const start = new Date(2026, 0, 5, 9, 0).getTime()
  const service = createBodyService({ now: () => start })

  const first = await service.tick(start)
  const again = await service.tick(start)

  assert.equal(again.energy, first.energy)
  assert.equal(again.hunger, first.hunger)
  assert.equal(again.updatedAt, first.updatedAt)
})

it('被吵到会计数，醒来只结算一次', async () => {
  const start = new Date(2026, 0, 5, 2, 0).getTime()
  const service = createBodyService({ now: () => start })

  await service.markInterrupted(start)
  await service.markInterrupted(start + 60_000)
  const result = await service.wake(start + 120_000)

  assert.equal(result.interrupted, 2)
  assert.ok(result.dream.length > 0)
  assert.equal(service.snapshot().interrupted, 0)
  assert.equal(service.snapshot().lastWokeInterrupted, 2)
})

it('睡着被叫醒不会把睡眠债一笔勾销', async () => {
  const { dir, file } = await tempBodyFile()
  const start = new Date(2026, 0, 5, 2, 0).getTime()
  const base = freshState(start)
  base.sleepDebt = 4
  base.updatedAt = start
  base.lastWakeAt = start - 20 * 3600_000
  await fs.writeFile(file, JSON.stringify(base), 'utf8')

  const service = createBodyService({ file, now: () => start })
  const woken = await service.markInterrupted(start + 60_000)
  await service.wake(start + 60_000)
  const state = service.snapshot()

  assert.equal(woken, 1)
  assert.ok(state.lastWokeInterrupted >= 1)
  // 只还了这一分钟里睡着的那一点点，原本欠下的几小时不能被清掉。
  assert.ok(state.sleepDebt > 3.5)

  await fs.rm(dir, { recursive: true, force: true })
})

it('连着说话会累，冷却期内不重复扣', async () => {
  const start = new Date(2026, 0, 5, 9, 0).getTime()
  const service = createBodyService({ now: () => start })

  const before = (await service.tick(start)).socialEnergy
  const after = (await service.noteChat(3, start)).socialEnergy
  assert.ok(after < before)

  const repeated = (await service.noteChat(3, start + 10_000)).socialEnergy
  assert.ok(Math.abs(repeated - after) < 0.2)

  const later = (await service.noteChat(3, start + 60_000)).socialEnergy
  assert.ok(later < repeated - 1)
})
