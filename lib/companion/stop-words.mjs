/**
 * 共享停用词：社交语感（梗识别）与记忆召回（bigram 相关度）共用一份标准。
 *
 * MEME_STOP_WORDS 是「整词」层面的停用词，用于判断一个短语是不是常见口头语；
 * STOP_BIGRAMS 由它按二字切分而来，并补了一小组高频虚词组合，
 * 供 bigram 召回直接过滤，避免「今天」「我们」「这个」这类组合把分数抬起来。
 */

export const MEME_STOP_WORDS = new Set([
  '哈哈',
  '哈哈哈',
  '哈哈哈哈',
  '真的',
  '确实',
  '可以',
  '不是',
  '什么',
  '怎么',
  '这个',
  '那个',
  '我们',
  '你们',
  '他们',
  '就是',
  '然后',
  '因为',
  '所以',
  '但是',
  '还是',
  '已经',
  '没有',
  '知道',
  '觉得',
  '感觉',
  '现在',
  '今天',
  '明天',
  '昨天',
  '晚安',
  '早安',
  '在吗',
  '好的',
  '收到',
  '谢谢'
])

/** 二字切分后仍然高频、几乎不携带主题信息的组合。 */
const EXTRA_STOP_BIGRAMS = [
  '一个',
  '一下',
  '一些',
  '一样',
  '时候',
  '还有',
  '如果',
  '自己',
  '这样',
  '那样',
  '这种',
  '那种',
  '的了',
  '了吗',
  '的呢',
  '了吧',
  '啊这',
  '嗯嗯',
  '哦哦',
  '是是'
]

function splitBigrams(word) {
  const chars = [...word]
  if (chars.length <= 2) return [word]
  const grams = []
  for (let index = 0; index < chars.length - 1; index += 1) {
    const head = chars[index]
    const tail = chars[index + 1]
    if (head !== undefined && tail !== undefined) grams.push(head + tail)
  }
  return grams
}

export const STOP_BIGRAMS = (() => {
  const grams = new Set(EXTRA_STOP_BIGRAMS)
  for (const word of MEME_STOP_WORDS) {
    for (const gram of splitBigrams(word)) grams.add(gram)
  }
  return grams
})()
