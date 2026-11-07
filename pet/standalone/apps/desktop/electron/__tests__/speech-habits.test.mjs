import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildHabitNote,
  createSpeechHabitStore,
  extractCandidates,
  observeText,
  pickPhrases,
  tailParticle
} from '../speech-habits.mjs'

function freshState() {
  return { version: 1, scopes: {} }
}

describe('extractCandidates', () => {
  it('拦掉停用词与人称片段', () => {
    const pieces = extractCandidates('今天我们去吃饭吧')
    expect(pieces).not.toContain('今天')
    expect(pieces).not.toContain('我们')
    expect(pieces).not.toContain('吃饭吧')
    expect(pieces.includes('吃饭')).toBe(true)
  })

  it('同一句话里重复出现的片段只算一次', () => {
    const pieces = extractCandidates('好家伙好家伙')
    expect(pieces.filter((item) => item === '好家伙')).toHaveLength(1)
  })

  it('纯标点与 emoji 不产生候选', () => {
    expect(extractCandidates('？！……😂')).toEqual([])
  })
})

describe('tailParticle', () => {
  it('剥掉句末标点再取语气词', () => {
    expect(tailParticle('真的呀！')).toBe('呀')
    expect(tailParticle('好吧……')).toBe('吧')
    expect(tailParticle('今天很累')).toBe('')
  })
})

describe('observeText / buildHabitNote', () => {
  it('样本不足时不输出任何语感提示', () => {
    const state = freshState()
    for (let i = 0; i < 5; i += 1) observeText(state, 'desktop', '好家伙这也太离谱了', i * 1000)
    expect(buildHabitNote(state, 'desktop')).toBe('')
  })

  it('听够之后给出短语、语气词与打字习惯', () => {
    const state = freshState()
    const lines = [
      '好家伙这也太离谱了呀',
      '好家伙你居然还记得呀',
      '真的离谱好家伙',
      '笑死我了呀',
      '笑死我了这个',
      '笑死我了真的'
    ]
    for (let i = 0; i < 14; i += 1) {
      observeText(state, 'desktop', lines[i % lines.length], i * 60_000)
    }
    const note = buildHabitNote(state, 'desktop')
    expect(note).toContain('好家伙')
    expect(note).toContain('笑死')
    expect(note).toContain('很少打句号')
    expect(note).toContain('别照搬')
  })

  it('长短语优先，短片段不重复占位', () => {
    const state = freshState()
    for (let i = 0; i < 5; i += 1) observeText(state, 'desktop', '好家伙真的离谱', i * 60_000)
    const phrases = pickPhrases(state.scopes.desktop)
    const texts = phrases.map((item) => item.text)
    expect(texts).toContain('好家伙')
    expect(texts).not.toContain('好家')
  })

  it('群聊 scope 不采样', () => {
    const state = freshState()
    observeText(state, 'qq:group:123', '好家伙这波操作', 1000)
    expect(state.scopes['qq:group:123']).toBeDefined()
    const store = createSpeechHabitStore({ filePath: null, now: () => 1000 })
    store.observe('qq:group:123', '好家伙这波操作', 1000)
    expect(store.snapshot('qq:group:123')).toBeNull()
  })

  it('超长消息不崩，长度按截断后的文本统计', () => {
    const state = freshState()
    const long = '好家伙'.repeat(500)
    expect(() => observeText(state, 'desktop', long, 1000)).not.toThrow()
    expect(state.scopes.desktop.samples).toBe(1)
  })
})

describe('createSpeechHabitStore', () => {
  it('落盘后能读回来', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-habits-'))
    const file = path.join(dir, 'habits.json')
    const first = createSpeechHabitStore({ filePath: file, now: () => 1000 })
    await first.load()
    for (let i = 0; i < 14; i += 1) first.observe('desktop', '好家伙这也太离谱了呀', i * 60_000)
    await first.flush()

    const second = createSpeechHabitStore({ filePath: file, now: () => 2000 })
    await second.load()
    expect(second.snapshot('desktop').samples).toBe(14)
    expect(second.note('desktop')).toContain('好家伙')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('文件损坏时从空白开始，不抛错', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-habits-'))
    const file = path.join(dir, 'habits.json')
    await fs.writeFile(file, '{ 这不是 json', 'utf8')
    const store = createSpeechHabitStore({ filePath: file, now: () => 1000 })
    await expect(store.load()).resolves.toBeTruthy()
    expect(store.note('desktop')).toBe('')
    await fs.rm(dir, { recursive: true, force: true })
  })
})
