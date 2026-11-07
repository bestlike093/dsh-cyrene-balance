import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../memory.mjs'

const tempDirs = []

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-memory-'))
  tempDirs.push(dir)
  return path.join(dir, 'memory.bin')
}

function makeStore(filePath, overrides = {}) {
  return createMemoryStore({
    filePath,
    seal: async (value) => value,
    open: async (sealed) => new TextEncoder().encode(JSON.stringify(sealed)),
    log: vi.fn(),
    ...overrides
  })
}

function texts(store) {
  return store.recent(10).map((item) => item.text)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('memory store clear 语义', () => {
  it('clear 成功：先落盘空记录，再归零内存', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '你好')
    store.appendTurn('assistant', '在的')
    expect(await store.flush()).toBe(true)
    expect(texts(store)).toEqual(['你好', '在的'])

    const result = await store.clear()

    expect(result).toEqual({ ok: true })
    expect(texts(store)).toEqual([])

    // 磁盘文件仍在，但内容是空记录；不断言文件不存在。
    const sealed = JSON.parse(await readFile(filePath, 'utf8'))
    expect(sealed.records).toEqual([])

    // 模拟重启：重新 load 后读出来也是空。
    const restarted = makeStore(filePath)
    const loaded = await restarted.load()
    expect(loaded).toEqual({ ok: true, count: 0 })
    expect(texts(restarted)).toEqual([])
  })

  it('clear 失败：内存恢复原数组，返回 persist-failed，磁盘仍是旧记录', async () => {
    const filePath = await tempFile()
    let sealCalls = 0
    const seal = async (value) => {
      sealCalls += 1
      if (sealCalls === 2) throw new Error('disk full')
      return value
    }
    const store = makeStore(filePath, { seal })
    store.appendTurn('user', '你好')
    store.appendTurn('assistant', '在的')
    expect(await store.flush()).toBe(true)

    const result = await store.clear()

    expect(result).toEqual({ ok: false, reason: 'persist-failed' })
    expect(texts(store)).toEqual(['你好', '在的'])

    // 失败路径不写盘；重新 load 后内容与 clear 前逐条一致。
    await store.load()
    expect(texts(store)).toEqual(['你好', '在的'])
  })

  it('并发 clear 复用同一个 promise 与结果对象，只触发一次落盘', async () => {
    const filePath = await tempFile()
    let sealCalls = 0
    const seal = async (value) => {
      sealCalls += 1
      return value
    }
    const store = makeStore(filePath, { seal })
    store.appendTurn('user', '你好')
    await store.flush()
    const before = sealCalls

    const first = store.clear()
    const second = store.clear()

    expect(first).toBe(second)
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(a).toEqual({ ok: true })
    expect(sealCalls - before).toBe(1)
  })
})

describe('memory store 原文层闸门', () => {
  it('凭据、角色扮演、纯寒暄不进记忆', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)

    expect(store.appendTurn('user', '我的密码是 abc12345')).toBe(false)
    expect(store.appendTurn('user', '（笑）好呀')).toBe(false)
    expect(store.appendTurn('user', '晚安')).toBe(false)
    expect(store.appendTurn('user', '我喜欢喝冰美式，不加糖')).toBe(true)

    expect(texts(store)).toEqual(['我喜欢喝冰美式，不加糖'])
  })

  it('临时状态仍然入库，第一步不扩大拦截范围', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)

    expect(store.appendTurn('user', '我今天好累，先睡了')).toBe(true)
    expect(texts(store)).toEqual(['我今天好累，先睡了'])
  })

  it('模型回复不套用户闸门，避免把一轮对话拆成不配对', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)

    expect(store.appendTurn('assistant', '晚安')).toBe(true)
    expect(texts(store)).toEqual(['晚安'])
  })
})

describe('memory store 按 scope 分桶', () => {
  const GROUP = { channel: 'qq', chatType: 'group', openId: 'group-1' }

  it('recent / digest 只返回本会话的记录', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '桌面的话')
    store.appendTurn('user', '群里的话', undefined, GROUP)

    expect(store.recent(10, 'desktop').map((item) => item.text)).toEqual(['桌面的话'])
    expect(store.recent(10, 'qq:group:group-1').map((item) => item.text)).toEqual(['群里的话'])
    expect(store.digestText(10, 'desktop')).toBe('用户：桌面的话')
    // 不传 scope 时仍是全局视图，管理页和诊断包不受影响。
    expect(store.recent(10).map((item) => item.text)).toEqual(['桌面的话', '群里的话'])
  })

  it('每个 scope 独立裁剪，一个会话刷屏不会挤掉另一个', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath, { maxItems: 2 })
    store.appendTurn('user', '桌面一')
    store.appendTurn('user', '桌面二')
    store.appendTurn('user', '群里一', undefined, GROUP)
    store.appendTurn('user', '群里二', undefined, GROUP)
    store.appendTurn('user', '群里三', undefined, GROUP)

    expect(store.recent(10, 'desktop').map((item) => item.text)).toEqual(['桌面一', '桌面二'])
    expect(store.recent(10, 'qq:group:group-1').map((item) => item.text)).toEqual(['群里二', '群里三'])
  })

  it('读取 v1 文件时就地补 scope 与 layer，落盘升级为 v4', async () => {
    const filePath = await tempFile()
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        records: [
          { id: 'a', role: 'user', text: '旧桌面', at: '' },
          { id: 'b', role: 'user', text: '旧群聊', at: '', source: GROUP }
        ]
      }),
      'utf8'
    )

    const store = makeStore(filePath)
    expect(await store.load()).toEqual({ ok: true, count: 2 })
    // 没有 source 的旧记录归桌面；带 source 的按来源分桶，不需要单独迁移脚本。
    expect(store.recent(10, 'desktop').map((item) => item.text)).toEqual(['旧桌面'])
    expect(store.recent(10, 'qq:group:group-1').map((item) => item.text)).toEqual(['旧群聊'])

    expect(await store.flush()).toBe(true)
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    expect(saved.version).toBe(5)
    expect(saved.records.map((item) => item.scope)).toEqual(['desktop', 'qq:group:group-1'])
    // 旧记录没有 layer，读入时回落 raw，下次落盘就带上。
    expect(saved.records.map((item) => item.layer)).toEqual(['raw', 'raw'])
    // v4 的两个新字段：被回忆次数与归档标记，旧记录一律从零开始。
    expect(saved.records.map((item) => item.recallCount)).toEqual([0, 0])
    expect(saved.records.map((item) => item.archived)).toEqual([false, false])
  })
})

describe('memory store 忘掉最近一轮', () => {
  const GROUP = { channel: 'qq', chatType: 'group', openId: 'group-1' }

  it('「别记这个」删掉当前 scope 的上一轮，不写入这句话本身', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '我喜欢喝冰美式')
    store.appendTurn('assistant', '记住了')
    store.appendTurn('user', '群里的话', undefined, GROUP)

    expect(store.appendTurn('user', '别记这个', undefined, null, 'desktop')).toBe(false)

    expect(store.recent(10).map((item) => item.text)).toEqual(['群里的话'])
  })

  it('删除只影响当前 scope', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '桌面的事')
    store.appendTurn('user', '群里的事', undefined, GROUP)

    const result = store.forgetLatest('qq:group:group-1')

    expect(result).toEqual({ ok: true, removed: 1 })
    expect(store.recent(10).map((item) => item.text)).toEqual(['桌面的事'])
  })

  it('没有可删的记录时返回 not-found，不动别的 scope', async () => {
    const filePath = await tempFile()
    const store = makeStore(filePath)
    store.appendTurn('user', '桌面的事')

    expect(store.forgetLatest('qq:private:someone')).toEqual({
      ok: false,
      reason: 'not-found',
      removed: 0
    })
    expect(store.recent(10).map((item) => item.text)).toEqual(['桌面的事'])
  })
})
