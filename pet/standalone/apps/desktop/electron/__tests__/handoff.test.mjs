import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canHandoff,
  createHandoffStore,
  DEFAULT_TTL_MS,
  summarizeHandoffTopic
} from '../handoff.mjs'

const tempDirs = []

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-handoff-'))
  tempDirs.push(dir)
  return path.join(dir, 'handoff.json')
}

function storeAt() {
  let now = new Date(2026, 10, 6, 22, 0, 0).getTime()
  const store = createHandoffStore({ now: () => now })
  return {
    store,
    tick: (ms) => (now += ms)
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('承接方向与摘要', () => {
  it('只在桌面与 QQ 私聊之间带话，群聊两头都不接', () => {
    expect(canHandoff('desktop', 'qq:private:u1')).toBe(true)
    expect(canHandoff('qq:private:u1', 'desktop')).toBe(true)
    expect(canHandoff('desktop', 'qq:group:g1')).toBe(false)
    expect(canHandoff('qq:group:g1', 'desktop')).toBe(false)
    expect(canHandoff('desktop', 'desktop')).toBe(false)
  })

  it('摘要只留对方那句话，不带她的回复，也不拼成长段', () => {
    const topic = summarizeHandoffTopic([
      { role: 'user', content: '打包卡住的事' },
      { role: 'assistant', content: '我记得你卡在签名那一步' }
    ])
    expect(topic).toBe('刚才在说「打包卡住的事」')
    expect(topic).not.toContain('签名')
  })

  it('只有她的回复时不编话题', () => {
    expect(summarizeHandoffTopic([{ role: 'assistant', content: '嗯。' }])).toBe('')
    expect(summarizeHandoffTopic([])).toBe('')
  })
})

describe('跨窗口承接', () => {
  it('写一句摘要，切到另一边时能读到', () => {
    const { store } = storeAt()
    const result = store.write({
      fromScope: 'desktop',
      toScope: 'qq:private:u1',
      topic: '刚才在说打包卡住的事'
    })
    expect(result.ok).toBe(true)
    expect(store.readFor('qq:private:u1')).toMatchObject({
      fromScope: 'desktop',
      toScope: 'qq:private:u1',
      topic: '刚才在说打包卡住的事',
      ttlMs: DEFAULT_TTL_MS
    })
    expect(store.readFor('desktop')).toBeNull()
  })

  it('同一对窗口只保留最新一条', () => {
    const { store } = storeAt()
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '第一句' })
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '第二句' })
    expect(store.list()).toHaveLength(1)
    expect(store.readFor('qq:private:u1').topic).toBe('第二句')
  })

  it('同一句只接一次，消费后不再重复出现', () => {
    const { store } = storeAt()
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '刚才在说打包' })
    expect(store.consumeFor('qq:private:u1')?.topic).toBe('刚才在说打包')
    expect(store.consumeFor('qq:private:u1')).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('到点自动失效，不注入过期的话', () => {
    const { store, tick } = storeAt()
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '刚才在说旅行' })
    tick(DEFAULT_TTL_MS)
    expect(store.readFor('qq:private:u1')).toBeNull()
    expect(store.list()).toEqual([])
  })

  it('不同目标窗口互不串台', () => {
    const { store } = storeAt()
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '甲' })
    store.write({ fromScope: 'desktop', toScope: 'qq:group:g1', topic: '乙' })
    expect(store.readFor('qq:private:u1').topic).toBe('甲')
    expect(store.readFor('qq:group:g1').topic).toBe('乙')
  })

  it('摘要压成一行并截断，不存长段落', () => {
    const { store } = storeAt()
    const long = `第一行\n第二行 ${'很长的内容'.repeat(40)}`
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: long })
    const entry = store.readFor('qq:private:u1')
    expect(entry.topic).not.toContain('\n')
    expect(entry.topic.length).toBeLessThanOrEqual(80)
  })

  it('空摘要和原地打转的承接都拒绝', () => {
    const { store } = storeAt()
    expect(store.write({ fromScope: '', toScope: 'qq:private:u1', topic: '话题' }).ok).toBe(false)
    expect(store.write({ fromScope: 'desktop', toScope: 'desktop', topic: '话题' }).ok).toBe(false)
    expect(store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '   ' }).ok).toBe(
      false
    )
  })

  it('可以按方向清掉承接', () => {
    const { store } = storeAt()
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '甲' })
    store.write({ fromScope: 'qq:private:u1', toScope: 'desktop', topic: '乙' })
    expect(store.clear({ fromScope: 'desktop' }).removed).toBe(1)
    expect(store.readFor('qq:private:u1')).toBeNull()
    expect(store.readFor('desktop').topic).toBe('乙')
  })
})

describe('承接记录持久化', () => {
  it('写盘带版本号，重开后还能读到', async () => {
    const file = await tempFile()
    const store = createHandoffStore({ file })
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u1', topic: '刚才在说搬家' })
    await store.flush()

    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.schemaVersion).toBe(2)
    expect(saved.entries).toHaveLength(1)

    const reopened = createHandoffStore({ file })
    await reopened.ready()
    expect(reopened.readFor('qq:private:u1').topic).toBe('刚才在说搬家')
  })

  it('旧文件落盘前留 .bak', async () => {
    const file = await tempFile()
    await writeFile(
      file,
      JSON.stringify({
        entries: [
          {
            fromScope: 'desktop',
            toScope: 'qq:private:u1',
            topic: '旧格式',
            createdAt: Date.now(),
            ttlMs: DEFAULT_TTL_MS
          }
        ]
      }),
      'utf8'
    )

    const store = createHandoffStore({ file })
    await store.ready()
    store.write({ fromScope: 'desktop', toScope: 'qq:private:u2', topic: '新的一条' })
    await store.flush()

    const backup = JSON.parse(await readFile(`${file}.bak`, 'utf8'))
    expect(backup.entries[0].topic).toBe('旧格式')
  })
})
