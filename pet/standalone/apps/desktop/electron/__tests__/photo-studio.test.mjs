import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createPhotoStudio,
  photoFileName,
  photoMediaUrl,
  resolvePhotoFolder,
  shouldSelfieInChat,
  wantsSelfie
} from '../photo-studio.mjs'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pet-photo-'))
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // 临时目录清不掉不影响断言结果。
  }
})

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('photoFileName', () => {
  it('按本地时间命名，同一秒内稳定', () => {
    const at = new Date(2026, 10, 7, 1, 5, 9)
    expect(photoFileName(at)).toBe('selfie-20261107-010509.png')
  })

  it('补零到两位，排序就是拍摄顺序', () => {
    const early = photoFileName(new Date(2026, 0, 2, 3, 4, 5))
    const late = photoFileName(new Date(2026, 0, 2, 3, 4, 6))
    expect(early).toBe('selfie-20260102-030405.png')
    expect(late > early).toBe(true)
  })
})

describe('resolvePhotoFolder', () => {
  it('设置里有路径就用设置的', () => {
    expect(resolvePhotoFolder({ preferred: 'D:\\照片', fallback: 'C:\\备用' })).toBe('D:\\照片')
  })

  it('设置里没填才用默认目录', () => {
    expect(resolvePhotoFolder({ preferred: '   ', fallback: 'D:\\默认' })).toBe('D:\\默认')
  })

  it('两边都空就返回空串', () => {
    expect(resolvePhotoFolder({})).toBe('')
  })
})

describe('拍照', () => {
  it('截到一帧就落盘，路径和时间都对得上', async () => {
    const studio = createPhotoStudio({
      folder: dir,
      capture: async () => png,
      now: () => new Date(2026, 10, 7, 1, 5, 9).getTime()
    })

    const result = await studio.take({ note: '窗边' })

    expect(result.ok).toBe(true)
    expect(result.photo.path).toBe(path.join(dir, 'selfie-20261107-010509.png'))
    expect(result.photo.bytes).toBe(png.length)
    expect(result.photo.note).toBe('窗边')
    expect(readFileSync(result.photo.path)).toEqual(png)
  })

  it('目录不存在会自动建出来', async () => {
    const nested = path.join(dir, 'a', 'b')
    const studio = createPhotoStudio({ folder: nested, capture: async () => png })

    const result = await studio.take()

    expect(result.ok).toBe(true)
    expect(readdirSync(nested)).toHaveLength(1)
  })

  it('没截到就不生成文件，也不报成功', async () => {
    const studio = createPhotoStudio({ folder: dir, capture: async () => null })

    const result = await studio.take()

    expect(result).toEqual({ ok: false, reason: 'empty-frame' })
    expect(readdirSync(dir)).toHaveLength(0)
  })

  it('截屏抛错时如实返回原因', async () => {
    const studio = createPhotoStudio({
      folder: dir,
      capture: async () => {
        throw new Error('window gone')
      }
    })

    const result = await studio.take()

    expect(result).toEqual({ ok: false, reason: 'capture-failed' })
    expect(readdirSync(dir)).toHaveLength(0)
  })

  it('没有目录或没有截屏能力时直接说不行', async () => {
    expect(await createPhotoStudio({ capture: async () => png }).take()).toEqual({
      ok: false,
      reason: 'no-folder'
    })
    expect(await createPhotoStudio({ folder: dir }).take()).toEqual({
      ok: false,
      reason: 'no-capture'
    })
  })

  it('最近拍过的按最新在前，最多八张', async () => {
    let tick = 0
    const studio = createPhotoStudio({
      folder: dir,
      capture: async () => png,
      now: () => new Date(2026, 10, 7, 1, 5, 0).getTime() + tick++ * 1000
    })

    for (let index = 0; index < 10; index += 1) await studio.take()

    const recent = studio.recentPhotos()
    expect(recent).toHaveLength(8)
    expect(recent[0].path).toContain('selfie-20261107-010509.png')
    expect(recent[7].path).toContain('selfie-20261107-010502.png')
  })
})

describe('wantsSelfie', () => {
  it('明确要一张照片的几种说法都算', () => {
    for (const said of ['拍张照', '自拍一张', '给我拍一张', '快照一下', '照张相给我看', '帮我拍张', '拍张照，发我可以吗？']) {
      expect(wantsSelfie(said), said).toBe(true)
    }
  })

  it('只是提到照片、或问能不能拍，都不算', () => {
    for (const said of ['这张照片真好看', '我把照片发你了', '能拍照吗', '为什么不能拍照', '拍照功能怎么用']) {
      expect(wantsSelfie(said), said).toBe(false)
    }
  })

  it('空文本与非字符串一律不算', () => {
    expect(wantsSelfie('')).toBe(false)
    expect(wantsSelfie('   ')).toBe(false)
    expect(wantsSelfie(undefined)).toBe(false)
    expect(wantsSelfie(42)).toBe(false)
  })
})

describe('shouldSelfieInChat', () => {
  it('私聊里明确要照片就去拍', () => {
    expect(shouldSelfieInChat({ text: '拍张照', chatType: 'private' })).toBe(true)
  })

  it('群里只认主人，陌生人要照片不拍', () => {
    expect(shouldSelfieInChat({ text: '拍张照', chatType: 'group', isOwner: false })).toBe(false)
    expect(shouldSelfieInChat({ text: '拍张照', chatType: 'group' })).toBe(false)
    expect(shouldSelfieInChat({ text: '拍张照', chatType: 'group', isOwner: true })).toBe(true)
  })

  it('不是要照片的说法一律不拍', () => {
    expect(shouldSelfieInChat({ text: '这张照片真好看', chatType: 'private' })).toBe(false)
    expect(shouldSelfieInChat({ text: '', chatType: 'private' })).toBe(false)
    expect(shouldSelfieInChat({})).toBe(false)
    expect(shouldSelfieInChat()).toBe(false)
  })
})

describe('photoMediaUrl', () => {
  it('照片目录里的文件给出协议地址，文件名做编码', () => {
    const url = photoMediaUrl(path.join(dir, 'selfie-20261107-010509.png'), dir)
    expect(url).toBe('pet-media://photo/selfie-20261107-010509.png')
  })

  it('目录外的路径不给地址', () => {
    const outside = path.join(dir, '..', 'secret.png')
    expect(photoMediaUrl(outside, dir)).toBe('')
  })

  it('目录为空或文件名怪的一律拒绝', () => {
    expect(photoMediaUrl(path.join(dir, 'a.png'), '')).toBe('')
    expect(photoMediaUrl(path.join(dir, '有 空格.png'), dir)).toBe('')
    expect(photoMediaUrl(path.join(dir, '../a.png'), dir)).toBe('')
    expect(photoMediaUrl(undefined, dir)).toBe('')
  })
})
