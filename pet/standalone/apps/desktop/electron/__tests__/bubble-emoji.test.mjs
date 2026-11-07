import { describe, expect, it } from 'vitest'
import { pickBubbleEmojiUrl } from '../renderer/bubble-emoji.mjs'

const files = {
  hi: 'pet-media://asset/cyrene/emoji/HI.png',
  goodnight: 'pet-media://asset/cyrene/emoji/goodnight.png'
}
const fallback = 'pet-media://asset/cyrene/emoji/neutral.png'

describe('气泡表情取图', () => {
  it('表情 id 还在素材里就用它', () => {
    expect(pickBubbleEmojiUrl({ emojiId: 'hi', files, stickerUrl: '', fallback })).toBe(files.hi)
  })

  it('旧聊天的表情 id 已经不在素材里，换成默认表情', () => {
    expect(pickBubbleEmojiUrl({ emojiId: 'retired-sticker', files, stickerUrl: '', fallback })).toBe(
      fallback
    )
  })

  it('旧 id 失效时也不拿用户贴纸顶替，仍用默认表情', () => {
    expect(
      pickBubbleEmojiUrl({ emojiId: 'retired-sticker', files, stickerUrl: 'pet-media://sticker.png', fallback })
    ).toBe(fallback)
  })

  it('没带表情 id 时，用户手选的贴纸优先', () => {
    expect(pickBubbleEmojiUrl({ emojiId: null, files, stickerUrl: 'pet-media://sticker.png', fallback })).toBe(
      'pet-media://sticker.png'
    )
  })

  it('没带 id 也没贴纸时用默认表情', () => {
    expect(pickBubbleEmojiUrl({ emojiId: '', files, stickerUrl: '', fallback })).toBe(fallback)
  })

  it('素材表和默认表情都缺时返回空串，让气泡收掉表情', () => {
    expect(pickBubbleEmojiUrl({ emojiId: 'hi', files: undefined, stickerUrl: '', fallback: '' })).toBe('')
  })
})
