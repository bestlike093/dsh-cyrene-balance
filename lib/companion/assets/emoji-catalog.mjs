/**
 * 默认表情清单：与 `assets/cyrene/emoji` 下的文件名一一对应。
 *
 * 这里只给 id、文件名、情绪与场景，不读像素。
 * 新增素材时只加一行，素材库和选图器都从这一份取。
 */

export const DEFAULT_EMOJI_CATALOG = [
  { id: 'airkiss', file: 'Airkiss.png', emotions: ['shy', 'gentle'], scenes: ['comfort', 'farewell'] },
  { id: 'allset', file: 'Allset.png', emotions: ['happy', 'excited'], scenes: ['morning', 'work'] },
  { id: 'awesome', file: 'awesome.png', emotions: ['happy', 'excited'], scenes: ['praise'] },
  { id: 'awkward', file: 'awkward.png', emotions: ['shy', 'neutral'], scenes: ['tease'] },
  { id: 'blushhard', file: 'blushhard.png', emotions: ['shy'], scenes: ['praise'] },
  { id: 'copythat', file: 'copythat.png', emotions: ['neutral', 'happy'], scenes: ['work'] },
  { id: 'deadtired', file: 'deadtired.png', emotions: ['tired'], scenes: ['night', 'work'] },
  { id: 'dream', file: 'Dreak.png', emotions: ['tired', 'gentle'], scenes: ['night'] },
  { id: 'eating', file: 'eating.png', emotions: ['happy'], scenes: ['meal', 'noon'] },
  { id: 'fighting', file: 'fighting.png', emotions: ['excited', 'happy'], scenes: ['work', 'morning'] },
  { id: 'foryou', file: 'foryou.png', emotions: ['gentle'], scenes: ['comfort'] },
  { id: 'free', file: 'Free.png', emotions: ['happy'], scenes: ['evening', 'farewell'] },
  { id: 'gigglelots', file: 'Gigglelots.png', emotions: ['happy', 'excited'], scenes: ['tease'] },
  { id: 'giveup', file: 'giveup.png', emotions: ['sad', 'tired'], scenes: ['work'] },
  { id: 'goodmorning', file: 'goodmoring1.png', emotions: ['happy', 'gentle'], scenes: ['morning', 'greeting'] },
  { id: 'goodnight', file: 'goodnight.png', emotions: ['gentle', 'tired'], scenes: ['night', 'farewell'] },
  { id: 'hello', file: 'hello.png', emotions: ['happy'], scenes: ['greeting'] },
  { id: 'hellyeah', file: 'hellyeah.png', emotions: ['excited'], scenes: ['praise'] },
  { id: 'hi', file: 'HI.png', emotions: ['happy'], scenes: ['greeting'] },
  { id: 'hmph', file: 'hmph.png', emotions: ['angry', 'shy'], scenes: ['tease'], weight: 0.45 },
  { id: 'hugtight', file: 'hugtight.png', emotions: ['gentle'], scenes: ['comfort'] },
  { id: 'hurtcry', file: 'Hurtcry.png', emotions: ['sad'], scenes: ['comfort'], weight: 0.5 },
  { id: 'madnow', file: 'Madnow.png', emotions: ['angry'], scenes: ['tease'], weight: 0.4 },
  { id: 'midmeh', file: 'midmeh.png', emotions: ['neutral'], scenes: ['lazy'], weight: 0.5 },
  { id: 'missme', file: 'missme.png', emotions: ['shy', 'gentle'], scenes: ['comfort'] },
  { id: 'ok', file: 'OK.png', emotions: ['neutral', 'happy'], scenes: ['work'] },
  { id: 'outfast', file: 'outfast.png', emotions: ['happy'], scenes: ['farewell'] },
  { id: 'paniccrying', file: 'PanincCrying.png', emotions: ['surprised', 'sad'], scenes: ['work'] },
  { id: 'please', file: 'please.png', emotions: ['shy', 'gentle'], scenes: ['comfort'] },
  { id: 'poorwallet', file: 'poorwallet.png', emotions: ['sad'], scenes: ['tease'], weight: 0.4 },
  { id: 'putmd', file: 'putmd.png', emotions: ['neutral'], scenes: ['lazy'], weight: 0.45 },
  { id: 'shyshort', file: 'shyshort.png', emotions: ['shy'], scenes: ['praise'] },
  { id: 'sleepynow', file: 'sleepynow.png', emotions: ['tired'], scenes: ['night'] },
  { id: 'sobbinghard', file: 'Sobbinghard.png', emotions: ['sad'], scenes: ['comfort'], weight: 0.45 },
  { id: 'sogood', file: 'sogood.png', emotions: ['happy'], scenes: ['meal', 'praise'] },
  { id: 'sonice', file: 'sonice.png', emotions: ['happy', 'gentle'], scenes: ['praise'] },
  { id: 'sotired', file: 'sotired.png', emotions: ['tired'], scenes: ['work', 'night'] },
  { id: 'teatime', file: 'teatime.png', emotions: ['gentle', 'happy'], scenes: ['afternoon', 'lazy'] },
  { id: 'thanks', file: 'Thanks.png', emotions: ['happy', 'gentle'], scenes: ['praise'] },
  { id: 'thinking', file: 'thinking.png', emotions: ['thinking'], scenes: ['work'] },
  { id: 'thumbsup', file: 'Thumbsup.png', emotions: ['happy'], scenes: ['praise', 'work'] },
  { id: 'vacayover', file: 'Vcayover.png', emotions: ['sad', 'tired'], scenes: ['work'], weight: 0.45 },
  { id: 'weeploud', file: 'weeploud.png', emotions: ['sad'], scenes: ['comfort'], weight: 0.4 },
  { id: 'whatswrong', file: 'Whatswrong.png', emotions: ['thinking', 'gentle'], scenes: ['comfort'] }
]

/** 表情 id → 默认文件；素材库拼地址时用。 */
export function emojiFileOf(id) {
  const found = DEFAULT_EMOJI_CATALOG.find((entry) => entry.id === id)
  return found === undefined ? '' : found.file
}
