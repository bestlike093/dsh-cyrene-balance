/**
 * 记忆脱敏单点（B2-001）。
 *
 * 为什么要单独成一个文件：scrub 原先是 memory-extract.mjs 的模块内私有函数，
 * 只有抽取链走得到它。QQ 链不经抽取直接写记忆库，那条路就没闸——账上 B2-001 钉的
 * 「写入边界没有闸」就是这个形状。修复要求 scrub 上移到写入边界（memory-store 的
 * normalizeItem），抽取链同时继续用同一份。
 *
 * 那就不能把它放进 memory-store.mjs：那个文件顶部 import node:fs/promises，
 * memory-extract.mjs 头部约束写着「纯函数，不依赖宿主与文件系统」（:10），
 * 顺着 import 过去就把文件系统依赖带进抽取链了。
 * 所以单点落在这里：两份纯函数，零依赖，抽取链与写入边界各自 import 同一份。
 */

/** 收空白与首尾标点；抽取链的分句也用它，保持与脱敏前处理一致。 */
export function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，,、：:；;]+/, '')
    .replace(/[，,、：:；;]+$/, '')
}

/*
 * 全角数字与全角 X 转半角，只转会影响判定这几类字符，不动其余文本。
 */
function toAsciiDigits(text) {
  return text
    /* 全角 ０ 是 U+FF10，半角 0 是 U+30；差值要再加回 0x30，
     * 只减 0xFF10 得到的是码点 0..9 的控制字符，什么都匹配不上。 */
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/[Ｘ]/g, 'X')
    .replace(/[ｘ]/g, 'x')
}

/*
 * B2-009：带分隔或全角的号码串。
 * 先把「数字之间夹空格/连字符」的整段抓出来，去掉分隔归一化，再按位数判型；
 * 判不出类型的原样退回。日期、订单号、版本号、数量词因此不受影响——
 * 归一化后凑不满这几种长度，就走不到擦除那一支。
 */
const DIGIT_RUN = /(?:[0-9０-９][\s-]?){7,}[0-9０-９XxＸｘ]/g

function scrubNumberRuns(value) {
  return value.replace(DIGIT_RUN, (run) => {
    const digits = toAsciiDigits(run).replace(/[\s-]/g, '')
    if (/^1[3-9]\d{9}$/.test(digits)) return '[手机号]'
    if (/^\d{17}[0-9Xx]$/.test(digits) || /^\d{15}$/.test(digits)) return '[身份证]'
    /* 卡号首位限 3~6（银联 / Visa / MC / Amex 那几段），减少把长编号当卡号的误伤 */
    if (/^[3-6]\d{15}$/.test(digits) || /^[3-6]\d{18}$/.test(digits)) return '[卡号]'
    return run
  })
}

/*
 * 记忆会进人格提示词，先脱敏：本机路径与链接换成占位；手机号 / 邮箱 / 身份证 /
 * 密钥样式字符串也一律占位，不留原文。身份证（18 位连续数字）必须排在手机号之前，
 * 否则会被手机号规则先截走前 11 位；邮箱排在手机号之前，避免截掉邮箱里的数字段。
 *
 * 顺序上有几处是有原因的，改之前先读完注释：
 * - 国际号前缀在手机号规则之前，否则 +86 会作为残渣留在占位符前面；
 * - 带 scheme 的链接在无 scheme 域名之前，否则同一句会被两条规则各擦一次；
 * - 号码串扫描放最后，前面的强模式已经把能确定的处理干净，剩下的分隔形态才交给它。
 */
export function scrub(value) {
  return scrubNumberRuns(
    clean(value)
      .replace(/(?:\+|＋)\s*(?:86|８６)[\s-]?(?=1[3-9][0-9０-９])/g, '')
      /* 盘符必须只占一个字母：不加这条边界，`https:/` 里的 `s:/` 会被当本地路径吃掉，
       * 实测回归过一次——「看这个链接 https://example.com/x」产出「http<本地路径>」。 */
      .replace(/(?<![A-Za-z0-9])[A-Za-z]:\\[^\s，。！？]{1,200}/g, '<本地路径>')
      .replace(/(?<![A-Za-z0-9])[A-Za-z]:\/[^\s，。！？]{1,200}/g, '<本地路径>')
      /* Unix 路径要求首段是常见根目录，普通「A/B 两个选项」这种斜杠不动 */
      .replace(/\/(?:home|Users|user|root|var|mnt|opt|tmp|proc|media|srv|etc)\/[^\s，。！？]{0,120}/g, '<本地路径>')
      .replace(/https?:\/\/[^\s，。！？]{1,200}/g, '<链接>')
      /* 无 scheme 域名必须带路径段才擦，裸域名（讨论站点名时常见）原样留着 */
      .replace(/\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:com|cn|net|org|io|cc|me|tv|dev|xyz|top|vip|edu|gov|info|biz|co|uk|jp|kr|de|fr|ru|au|ca)\/[^\s，。！？]{0,120}/g, '<链接>')
      .replace(/\b\d{17}[\dXx]\b/g, '[身份证]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
      .replace(/1[3-9]\d{9}(?!\d)/g, '[手机号]')
      .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|AKIA[A-Z0-9]{12,})\b/g, '[密钥]')
  )
}
