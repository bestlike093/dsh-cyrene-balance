import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPackStore, isSafeEntryName, kindFromPath, packUrl } from '../packs.mjs'

let work
let store

async function makeZip(name, entries) {
  const zip = new AdmZip()
  for (const [entryName, content] of entries) {
    zip.addFile(entryName, Buffer.isBuffer(content) ? content : Buffer.from(content))
  }
  const target = path.join(work, name)
  zip.writeZip(target)
  return target
}

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-packs-'))
  store = createPackStore({ root: path.join(work, 'packs') })
})

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true })
})

describe('kindFromPath', () => {
  it('按目录名分类四类素材', () => {
    expect(kindFromPath('emoji/happy.png')).toBe('emoji')
    expect(kindFromPath('icons/tray.png')).toBe('icon')
    // 本体素材的托盘图标是 ico，同样要能进 icon 分类。
    expect(kindFromPath('icons/tray.ico')).toBe('icon')
    expect(kindFromPath('fonts/xx.ttf')).toBe('font')
    expect(kindFromPath('bubbles/normal.png')).toBe('bubble')
  })

  it('根目录的图片只能靠文件名判断，认不出返回 null', () => {
    expect(kindFromPath('bubble-pink.png')).toBe('bubble')
    expect(kindFromPath('random.png')).toBeNull()
    expect(kindFromPath('notes/readme.md')).toBeNull()
  })
})

describe('packUrl', () => {
  it('逐段编码并带 pack 前缀', () => {
    expect(packUrl('my pack', 'fonts/字体 1.ttf'))
      .toBe(`pet-media://pack/my%20pack/fonts/${encodeURIComponent('字体 1.ttf')}`)
  })
})

describe('createPackStore', () => {
  it('带 pack.json 时按声明读元信息，文件仍按路径分类', async () => {
    const zip = await makeZip('pack.zip', [
      ['pack.json', JSON.stringify({
        id: 'demo',
        name: '演示素材',
        version: '1.2.0',
        kinds: ['emoji', 'font'],
        fonts: [{ file: 'fonts/xx.ttf', family: 'XX Sans' }],
        bubble: { file: 'bubbles/normal.png', slice: 18 }
      })],
      ['emoji/happy.png', 'png'],
      ['fonts/xx.ttf', 'ttf'],
      ['bubbles/normal.png', 'png']
    ])

    const pack = await store.importFromZip(zip)
    expect(pack.id).toBe('demo')
    expect(pack.name).toBe('演示素材')
    expect(pack.version).toBe('1.2.0')
    expect(pack.metaSource).toBe('manifest')
    expect(pack.kinds).toEqual(['emoji', 'font', 'bubble'])
    expect(pack.counts).toEqual({ emoji: 1, icon: 0, font: 1, bubble: 1 })
    expect(pack.files.font[0].family).toBe('XX Sans')
    expect(pack.bubble.slice).toBe(18)

    const listed = await store.list()
    expect(listed.map((item) => item.id)).toEqual(['demo'])
    expect(listed[0].broken).toBe(false)
  })

  it('认不出素材的包也列出来，并标记为损坏', async () => {
    const dir = path.join(work, 'packs', '空包')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'notes.txt'), 'nothing here', 'utf8')

    const listed = await store.list()
    expect(listed.map((item) => item.id)).toEqual(['空包'])
    expect(listed[0].broken).toBe(true)
    expect(listed[0].kinds).toEqual([])
  })

  it('没有 pack.json 时按目录推断，并标记 guessed', async () => {
    const zip = await makeZip('推 断.zip', [
      ['表情/happy.png', 'png'],
      ['icons/tray.png', 'png'],
      ['fonts/xx.woff2', 'woff'],
      ['bubbles/pink.png', 'png'],
      ['docs/readme.md', 'text']
    ])

    const pack = await store.importFromZip(zip)
    expect(pack.metaSource).toBe('guessed')
    expect(pack.kinds).toEqual(['emoji', 'icon', 'font', 'bubble'])
    expect(pack.files.font[0].family).toBe('xx')
  })

  it('拒绝 zip slip 路径', () => {
    // AdmZip 写入时会把 ../ 规范化掉，所以直接测校验函数本身。
    expect(isSafeEntryName('emoji/happy.png')).toBe(true)
    expect(isSafeEntryName('../evil.png')).toBe(false)
    expect(isSafeEntryName('emoji/../../evil.png')).toBe(false)
    expect(isSafeEntryName('/abs/evil.png')).toBe(false)
    expect(isSafeEntryName('emoji\\..\\evil.png')).toBe(false)
  })

  it('没有任何可识别素材时整包拒绝', async () => {
    const zip = await makeZip('empty.zip', [
      ['docs/readme.md', 'text'],
      ['img/random.png', 'png']
    ])
    await expect(store.importFromZip(zip)).rejects.toThrow(/没有可识别/)
  })

  it('拒绝 Live2D 模型文件', async () => {
    const zip = await makeZip('model.zip', [
      ['emoji/happy.png', 'png'],
      ['model.moc3', 'moc']
    ])
    await expect(store.importFromZip(zip)).rejects.toThrow(/Live2D/)
  })

  it('拒绝超过 16MB 的单文件', async () => {
    const zip = await makeZip('big.zip', [
      ['emoji/huge.png', Buffer.alloc(16 * 1024 * 1024 + 1)]
    ])
    await expect(store.importFromZip(zip)).rejects.toThrow(/16MB/)
  })

  it('重名自动加后缀，删除后列表为空', async () => {
    const zipPath = path.join(work, 'dup.zip')
    const build = () => {
      const zip = new AdmZip()
      zip.addFile('emoji/happy.png', Buffer.from('png'))
      zip.writeZip(zipPath)
    }

    build()
    const first = await store.importFromZip(zipPath)
    build()
    const second = await store.importFromZip(zipPath)
    expect(second.id).toBe(`${first.id}-2`)

    await store.remove(first.id)
    const listed = await store.list()
    expect(listed.map((item) => item.id)).toEqual([second.id])
  })

  it('resolvePackPath 挡住越界路径', () => {
    const root = path.join(work, 'packs')
    expect(store.resolvePackPath('demo', 'emoji/a.png'))
      .toBe(path.join(root, 'demo', 'emoji', 'a.png'))
    expect(store.resolvePackPath('demo', '../outside.png')).toBeNull()
    expect(store.resolvePackPath('../demo', 'a.png')).toBeNull()
  })
})

describe('导入失败的结构化原因', () => {
  it('一次带回全部校验问题，而不是只报第一条', async () => {
    const zipPath = await makeZip('two-models.zip', [
      ['emoji/a.moc3', 'x'],
      ['emoji/b.moc3', 'y']
    ])

    const error = await store.importFromZip(zipPath).catch((thrown) => thrown)
    expect(error.code).toBe('MODEL_FILE')
    expect(Array.isArray(error.details)).toBe(true)
    expect(error.details).toHaveLength(2)
    expect(error.details.map((item) => item.entry)).toEqual(['emoji/a.moc3', 'emoji/b.moc3'])
  })

  it('没有可识别素材时给出可执行的下一步', async () => {
    const zipPath = await makeZip('no-assets.zip', [['notes/readme.md', 'hello']])

    const error = await store.importFromZip(zipPath).catch((thrown) => thrown)
    expect(error.code).toBe('NO_RECOGNIZED')
    expect(error.details.length).toBeGreaterThanOrEqual(2)
    expect(error.details.map((item) => item.message).join(' ')).toContain('emoji')
  })
})
