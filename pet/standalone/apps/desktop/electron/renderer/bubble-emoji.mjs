/**
 * 气泡表情取图。
 *
 * 聊天记录里存的是表情 id，素材可能已经从包里换掉或删掉；
 * 这时不能把气泡空着，统一换成默认表情。
 *
 * 顺序：
 * - 这一句带了 id：能对上素材就用它，对不上（旧 id）就用默认表情
 * - 没带 id：用户手选的贴纸优先，其次默认表情
 */
export function pickBubbleEmojiUrl({ emojiId, files, stickerUrl = '', fallback = '' }) {
  const hasId = typeof emojiId === 'string' && emojiId !== ''
  if (hasId) {
    const byId = files?.[emojiId]
    return typeof byId === 'string' && byId !== '' ? byId : fallback
  }
  const sticker = typeof stickerUrl === 'string' ? stickerUrl : ''
  return sticker !== '' ? sticker : fallback
}
