import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createStickerInbox } from '../sticker-inbox.mjs'

/** 一张最小 PNG 头；只用来测落盘和指纹，不需要真能解码。 */
function pngBuffer(tag = 'a') {
  const head = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
    0x52, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00, 0x40, 0x08, 0x06, 0x00, 0x00, 0x00
  ])
  return Buffer.concat([head, Buffer.from(tag, 'utf8')])
}

describe('sticker-inbox 指纹与来源', () => {
  let root

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sticker-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('同一张图第二次只更新指纹，不再落一份', async () => {
    const inbox = createStickerInbox({ root })
    const buffer = pngBuffer('same')

    const first = await inbox.add({ buffer, contentType: 'image/png', senderOpenId: 'u1' })
    const second = await inbox.add({ buffer, contentType: 'image/png', senderOpenId: 'u2' })

    expect(first.duplicate).toBeUndefined()
    expect(second.duplicate).toBe(true)
    expect(second.id).toBe(first.id)
    expect(await inbox.list()).toHaveLength(1)
  })

  it('指纹表记下最近一次出现，次数会累加', async () => {
    const inbox = createStickerInbox({ root })
    const buffer = pngBuffer('count')
    await inbox.add({ buffer, contentType: 'image/png' })
    await inbox.add({ buffer, contentType: 'image/png' })

    const raw = await fs.readFile(path.join(root, '.inbox', 'hashes.json'), 'utf8')
    const hashes = JSON.parse(raw).items
    expect(hashes).toHaveLength(1)
    expect(hashes[0].seenCount).toBe(2)
    expect(hashes[0].lastSeenAt).toBeGreaterThanOrEqual(hashes[0].firstSeenAt)
  })

  it('群号与发图的人分开记录', async () => {
    const inbox = createStickerInbox({ root })
    const item = await inbox.add({
      buffer: pngBuffer('meta'),
      contentType: 'image/png',
      chatType: 'group',
      groupOpenId: 'group-1',
      senderOpenId: 'member-9'
    })

    expect(item.groupOpenId).toBe('group-1')
    const [listed] = await inbox.list()
    expect(listed.groupOpenId).toBe('group-1')
    expect(listed.senderOpenId).toBe('member-9')
  })

  it('指纹文件不能通过 pet-media://inbox 读出去', async () => {
    const inbox = createStickerInbox({ root })
    expect(await inbox.resolvePath('hashes.json')).toBeNull()
    expect(await inbox.resolvePath('index.json')).toBeNull()
  })
})
