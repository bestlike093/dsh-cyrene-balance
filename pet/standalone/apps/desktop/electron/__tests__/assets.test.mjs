import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetUrl, createAssetLibrary } from '../assets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoAssets = path.resolve(here, '../../../../assets')

let root

async function touch(relative, content = '') {
  const target = path.join(root, relative)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content)
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-assets-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('assetUrl', () => {
  it('拼出 pet-media://asset 前缀，逐段编码', () => {
    expect(assetUrl('cyrene/stand/default.png'))
      .toBe('pet-media://asset/cyrene/stand/default.png')
    expect(assetUrl(path.join('立绘 素材', 'stand-01.png')))
      .toBe(`pet-media://asset/${encodeURIComponent('立绘 素材')}/stand-01.png`)
  })

  it('忽略首尾多余的分隔符', () => {
    expect(assetUrl('/a//b.png')).toBe('pet-media://asset/a/b.png')
  })
})

describe('createAssetLibrary', () => {
  it('列表情时用文件名做展示名，跳过非图片', async () => {
    await touch('demo-emoji/awesome.png')
    await touch('demo-emoji/calm.png')
    await touch('demo-emoji/README.md')

    const result = await createAssetLibrary({ root }).list()

    expect(result.ok).toBe(true)
    expect(result.total).toBe(2)
    expect(result.groups).toHaveLength(1)
    // 没有登记展示名的目录直接用目录名，不瞎猜。
    expect(result.groups[0].name).toBe('demo-emoji')
    expect(result.groups[0].items.map((item) => item.name)).toEqual(['awesome', 'calm'])
    expect(result.groups[0].items[0].url).toBe('pet-media://asset/demo-emoji/awesome.png')
  })

  it('没有登记名的目录里，子目录不会被递归列出', async () => {
    await touch('demo-emoji/nested/deep.png')
    await touch('demo-emoji/top.png')

    const result = await createAssetLibrary({ root }).list()

    expect(result.total).toBe(1)
    expect(result.groups[0].items[0].file).toBe('top.png')
  })

  it('目录不存在时报 assets-missing，而不是抛错', async () => {
    const result = await createAssetLibrary({ root: path.join(root, 'missing') }).list()
    expect(result).toEqual({ ok: true, groups: [], total: 0, reason: 'assets-missing' })
  })

  it('cyrene 只列立绘/帧/头像，并按 manifest 解析子目录地址', async () => {
    await touch('cyrene/stand/default.png')
    await touch('cyrene/stand/calm.png')
    await touch('cyrene/frames/frame-01.png')
    await touch('cyrene/emoji/awesome.png')
    await touch('cyrene/avatar.png')
    // PowerShell 生成的 manifest 带 BOM，解析前必须剥掉。
    await fs.writeFile(
      path.join(root, 'cyrene', 'manifest.json'),
      `\uFEFF${JSON.stringify({
        poses: { default: 'stand/default.png' },
        emotions: { happy: 'emoji/awesome.png' },
        avatar: 'avatar.png'
      })}`,
      'utf8'
    )

    const result = await createAssetLibrary({ root }).list()

    expect(result.groups[0].id).toBe('cyrene')
    expect(result.groups[0].name).toBe('Cyrene · 默认素材')
    expect(result.groups[0].items.map((item) => item.file))
      .toEqual(['avatar.png', 'frames/frame-01.png', 'stand/calm.png', 'stand/default.png'])
    expect(result.cyrene.poses.default).toBe('pet-media://asset/cyrene/stand/default.png')
    expect(result.cyrene.emotions.happy).toBe('pet-media://asset/cyrene/emoji/awesome.png')
  })

  it('manifest 缺失时仍然列出 cyrene，只是不给 cyrene 字段', async () => {
    await touch('cyrene/stand/default.png')

    const result = await createAssetLibrary({ root }).list()

    expect(result.groups[0].id).toBe('cyrene')
    expect(result.cyrene).toBeUndefined()
  })

  it('仓库里真实的 assets/ 能列出随包素材', async () => {
    const result = await createAssetLibrary({ root: repoAssets }).list()

    expect(result.ok).toBe(true)
    // 仓库里的随包素材只留 cyrene；旧的 whale-girl 三组已删，不能再回来。
    const ids = result.groups.map((group) => group.id)
    expect(ids).toContain('cyrene')
    expect(ids).not.toContain('whale-girl-stand')
    expect(ids.some((id) => id.startsWith('whale-girl'))).toBe(false)
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.groups.every((group) => group.items.every((item) => item.url.startsWith('pet-media://asset/'))))
      .toBe(true)
    expect(result.total).toBe(result.groups.reduce((sum, group) => sum + group.items.length, 0))

    const cyrene = result.groups.find((group) => group.id === 'cyrene')
    expect(cyrene.items.some((item) => item.file === 'stand/default.png')).toBe(true)
    expect(cyrene.items.some((item) => item.file === 'avatar.png')).toBe(true)
    // 表情不进 items，但 manifest 已把它们解析成可用地址。
    expect(result.cyrene.poses.default).toBe('pet-media://asset/cyrene/stand/default.png')
    expect(Object.keys(result.cyrene.emotions).length).toBeGreaterThan(10)
  })
})
