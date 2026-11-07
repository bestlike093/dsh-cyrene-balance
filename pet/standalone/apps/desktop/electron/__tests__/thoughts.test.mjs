import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createThoughtPool, gateOf } from '../thoughts.mjs'

function poolAt(hour = 15) {
  let now = new Date(2026, 10, 6, hour, 0, 0).getTime()
  const pool = createThoughtPool({ now: () => now })
  return { pool, tick: (ms = 1_000) => (now += ms), setHour: (value) => (now = new Date(2026, 10, 6, value, 0, 0).getTime()) }
}

describe('createThoughtPool 念头生命周期', () => {
  it('同一条还开着的念头不会重复入池', () => {
    const { pool } = poolAt()
    const first = pool.add({ text: '想问问她今天顺不顺利' })
    const second = pool.add({ text: '想问问她今天顺不顺利' })

    expect(second.id).toBe(first.id)
    expect(pool.list()).toHaveLength(1)
  })

  it('过期只改状态，不删除', () => {
    const { pool, tick } = poolAt()
    pool.add({ text: '明天提醒她带伞', ttlMs: 60_000 })
    tick(120_000)

    expect(pool.list({ status: 'open' })).toHaveLength(0)
    expect(pool.list({ status: 'expired' })).toHaveLength(1)
    expect(pool.snapshot().counts).toMatchObject({ open: 0, expired: 1 })
  })

  it('用掉与放下都只能从 open 转，重复调用不覆盖状态', () => {
    const { pool } = poolAt()
    const first = pool.add({ text: '想接上次的话头' })
    expect(pool.markUsed(first.id)?.status).toBe('used')
    expect(pool.markUsed(first.id)).toBeNull()

    const second = pool.add({ text: '另一句' })
    expect(pool.drop(second.id, { reason: 'not_relevant' })?.status).toBe('dropped')
    expect(pool.drop(second.id)).toBeNull()
  })

  it('最多保留 40 条，超出丢最旧的', () => {
    const { pool, tick } = poolAt()
    for (let index = 1; index <= 45; index += 1) {
      pool.add({ text: `念头 ${index}` })
      tick(10)
    }
    const all = pool.list({ limit: 100 })
    expect(all).toHaveLength(40)
    expect(all[0].text).toBe('念头 45')
    expect(all.some((item) => item.text === '念头 5')).toBe(false)
  })

  it('能按话题片段挑出最接近的念头', () => {
    const { pool } = poolAt()
    pool.add({ text: '她说想学 Rust，回头可以问问进度' })
    pool.add({ text: '周末想去看银杏' })

    const picked = pool.pickForHits([{ fragment: 'Rust' }])
    expect(picked?.text).toContain('Rust')
    expect(pool.pickForHits([])).toBeNull()
  })
})

describe('createThoughtPool 主动决策记录', () => {
  it('决策记录按时间倒序，gate 与 reason 都不为空', () => {
    const { pool, tick } = poolAt()
    pool.recordDecision({ reason: 'cooldown', speak: false })
    tick()
    pool.recordDecision({ reason: 'addressed', speak: true })

    const [latest, older] = pool.decisions()
    expect(latest).toMatchObject({ gate: 'open', reason: 'addressed', speak: true })
    expect(older).toMatchObject({ gate: 'hard', reason: 'cooldown', speak: false })
    expect(latest.gate).not.toBe('')
    expect(latest.reason).not.toBe('')
  })

  it('传入空 reason 时补 unknown，不会留下空字段', () => {
    const { pool } = poolAt()
    const decision = pool.recordDecision({ reason: '' })
    expect(decision.reason).toBe('unknown')
    expect(decision.gate).toBe('hard')
    expect(gateOf('')).toBe('no_reason')
  })

  it('深夜判断记成 hard，明确被叫到记成 open', () => {
    const { pool, setHour } = poolAt(3)
    const quiet = pool.decideAndRecord({ text: '昔涟你在吗', scope: 'qq:group:1' })
    expect(quiet).toMatchObject({ speak: false, reason: 'quiet_hours' })
    expect(pool.decisions()[0]).toMatchObject({ gate: 'hard', reason: 'quiet_hours' })

    setHour(15)
    const addressed = pool.decideAndRecord({ text: '昔涟你在吗', addressed: true, scope: 'qq:group:1' })
    expect(addressed).toMatchObject({ speak: true, reason: 'addressed' })
    expect(pool.decisions()[0]).toMatchObject({ gate: 'open', reason: 'addressed' })
  })

  it('放行时命中念头，会顺手标记为已用', () => {
    const { pool } = poolAt(15)
    const thought = pool.add({ text: '她说在学 Rust' })
    pool.decideAndRecord({
      text: 'Rust 的借用检查真难',
      facts: ['Rust'],
      scope: 'desktop'
    })

    expect(pool.list({ status: 'used' })[0].id).toBe(thought.id)
    expect(pool.decisions()[0].thoughtId).toBe(thought.id)
  })

  it('决策记录最多保留 40 条', () => {
    const { pool, tick } = poolAt()
    for (let index = 1; index <= 45; index += 1) {
      pool.recordDecision({ reason: index % 2 === 0 ? 'addressed' : 'cooldown' })
      tick(10)
    }
    const all = pool.decisions({ limit: 100 })
    expect(all).toHaveLength(40)
    expect(all[0].at).toBeGreaterThan(all[39].at)
  })
})

describe('createThoughtPool 数据迁移', () => {
  it('旧文件补默认结构，落盘前留 .bak', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thoughts-'))
    const file = path.join(dir, 'thoughts.json')
    await fs.writeFile(
      file,
      JSON.stringify({ thoughts: [{ text: '旧念头', at: 111 }], decisions: [] }),
      'utf8'
    )

    const pool = createThoughtPool({ file, now: () => 222 })
    await pool.ready()
    expect(pool.list()[0]).toMatchObject({ text: '旧念头', status: 'open' })

    pool.add({ text: '新念头' })
    await pool.flush()

    const saved = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(saved.schemaVersion).toBe(2)
    const backup = JSON.parse(await fs.readFile(`${file}.bak`, 'utf8'))
    expect(backup.thoughts[0].text).toBe('旧念头')
  })

  it('新版文件再次读取不重复写 .bak', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thoughts-'))
    const file = path.join(dir, 'thoughts.json')
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 2, thoughts: [], decisions: [] }), 'utf8')

    const pool = createThoughtPool({ file })
    await pool.ready()
    pool.add({ text: '一句念头' })
    await pool.flush()
    await expect(fs.access(`${file}.bak`)).rejects.toThrow()
  })
})
