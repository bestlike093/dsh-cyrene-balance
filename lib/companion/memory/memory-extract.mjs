/**
 * 从会话里的用户发言挑出「值得记住的事」，按 13 槽里 7 个启用槽选槽。
 *
 * 规则版只出能明确判定的槽：identity / preference / knowledge / project / promise / event。
 * lesson 只从审核改判与反思聚合来，不由规则抽取。
 * 每条候选带 confidence（0~1）与 evidence（原句裁剪）：
 * - 高置信（明确标记词，如「我叫/记住/喜欢」）可以直接入库；
 * - 中置信（模糊推断，如「我最近/我准备」）进候选箱等审核；
 * - 代码行、问句和纯链接先排除，宁可少记，也不把噪音塞进记忆。
 *   「纯链接」按整句判（剥掉链接与标点后什么都不剩才算），含链接的日常句照旧抽取（B2-008）。
 * 纯函数，不依赖宿主与文件系统。
 */

import { FILTER } from '../standard.mjs'
/* 脱敏单点在 scrub.mjs：抽取链与写入边界（memory-store 的 normalizeItem）共用同一份，
 * 这里保持零文件系统依赖，只借两个纯函数。 */
import { clean, scrub } from './scrub.mjs'

/* B2-008：这里只放**代码形状**。'http://' / 'https://' 原先混在表里，
 * 配合 :38 的任意位置子串命中与 :41「逗号不断句」的分句，一句日常话挂个链接
 * 就连同「我叫…」一起判死（实测：「我叫<助手>，官网 https://qidian.com 上能看到」抽不出 identity，
 * 同一句把逗号换成句号就能抽出）。链接该不该排除，问的是「这句除了链接还剩什么」，
 * 交给下面 isLinkOnly 按 docstring :9 的原意「纯链接先排除」判。
 * 代码那一头保持子串判死 —— 放松它会放进「const a = 1 // 我喜欢这个」这类注释噪音。 */
const CODE_HINTS = ['function', 'const ', 'let ', '=>', '#!/', '```']
const QUESTION_TAIL = /(吗|呢|么|嘛)[？?]?$/
const MAX_TEXT = FILTER.candidateTextLimit
/* 置信度分档统一取标准，模块里只决定「这句话属于哪一档」。 */
const CONF = FILTER.extractConfidence

/* 单条消息的抽取上限直接取标准值；单轮调用方还有一道总闸。 */
export const MAX_PER_MESSAGE = FILTER.maxPerTurn
export const PER_ROUND_LIMIT = FILTER.perRoundLimit

/* 显式记忆词：被点名要记的句子，配合具体信息兜底放行。 */
const MEMORY_WORDS = /(记住|记着|别忘了|别忘|帮我记|记一下|记下来|记上|要记得|记得要)/
/*
 * 具体信息：数字、日期/星期词、常见地名后缀、拉丁字母串。
 * 纯中文的人名地名没有词典认不出来，这里只做保守覆盖，宁少放也不误放。
 */
const CONCRETE_HINT =
  /(\d|[A-Za-z]{2,}|(?:周|星期)[一二三四五六日天]?|(?:今|明|后|昨)天|(?:市|省|县|区|路|街|村|镇|公司|学校|医院|机场|车站))/

export function looksLikeCode(sentence) {
  return CODE_HINTS.some((hint) => sentence.includes(hint))
}

/* 整句除了链接与标点连接符之外什么都不剩，才算「纯链接」——照 docstring :9 的原意。
 * 只看链接、不看正文长度，是因为正文该不该记由各槽的正则决定，这一层只管噪音整句。
 * 落库时的脱敏不归这里：scrub.mjs 会把链接换成占位符，那是另一颗（B2-001/B2-009）。 */
const URL_TOKEN = /https?:\/\/\S+/g
const LINK_GLUE = /[\s\p{P}\p{S}]+/gu

export function isLinkOnly(sentence) {
  if (typeof sentence !== 'string' || !sentence.includes('http')) return false
  return sentence.replace(URL_TOKEN, '').replace(LINK_GLUE, '') === ''
}

function sentencesOf(text) {
  return String(text ?? '')
    .slice(0, FILTER.messageTextLimit)
    .split(/[。！？!?\n]+/)
    .map(clean)
    .filter((sentence) => sentence.length >= FILTER.sentenceMinLength && sentence.length <= FILTER.sentenceMaxLength)
}

/**
 * @param {string} text 一条用户发言
 * @returns {Array<{
 *   slot: 'identity'|'preference'|'knowledge'|'project'|'promise'|'event',
 *   text: string,
 *   confidence: number,
 *   evidence: string
 * }>}
 */
export function extractMemoryCandidates(text) {
  const found = []
  const seen = new Set()

  function push(slot, value, confidence) {
    const line = scrub(value).slice(0, MAX_TEXT)
    if (line.length < 2 || seen.has(line) || QUESTION_TAIL.test(line)) return
    seen.add(line)
    found.push({
      slot,
      text: line,
      confidence,
      evidence: scrub(String(value)).slice(0, MAX_TEXT)
    })
  }

  for (const sentence of sentencesOf(text)) {
    if (looksLikeCode(sentence) || isLinkOnly(sentence)) continue

    // identity：明确的自称与称呼，置信度高。
    const name = sentence.match(/我(?:的名字)?叫\s*(?!你|您|他|她|它|大家|你们|他们|她们|别|不要|不|快|赶紧|现在|马上)([^\s，。！？、]{1,20})/)
    if (name !== null && !['什么', '你', '他', '她'].includes(name[1])) {
      push('identity', `对方叫${name[1]}`, CONF.name)
    } else {
      const called = sentence.match(/(?:你可以|就)叫我\s*([^\s，。！？、]{1,20})/)
      if (called !== null && !['什么', '你', '他', '她'].includes(called[1])) {
        push('identity', `对方希望被叫做${called[1]}`, CONF.alias)
      }
    }

    // preference：明确的好恶。
    const like = sentence.match(/(?:我(?:很|挺|超|特别|最)?|(?:^|[，,、；;]))喜欢\s*([^，。！？]{1,40})/)
    if (like !== null) push('preference', `对方喜欢${like[1]}`, CONF.like)

    const dislike = sentence.match(
      /(?:我(?:很|挺|超|特别|最)?|(?:^|[，,、；;]))(?:不喜欢|讨厌|受不了|害怕)\s*([^，。！？]{1,40})/,
    )
    if (dislike !== null) push('preference', `对方不喜欢${dislike[1]}`, CONF.dislike)

    // promise：约定、托付、承诺（旧 relation 槽并入这里）。
    const remember = sentence.match(/(?:记住|别忘|帮我记|记一下|说好了|答应你)[：:，, ]*(?:住)?([^。！？]{2,80})/)
    let rememberValue = null
    if (remember !== null) {
      // 剥掉语气词与空指令残片：「记住啊，周三开会」只留「周三开会」。
      const body = remember[1].replace(/^[啊哦嗯呀哟]+[，,、：: ]*/, '').replace(/[，,、：: ]*[啊哦嗯呀哟]+$/, '').trim()
      if (body.length >= 2 && !/^(下来|一下|着|上|了)$/.test(body)) {
        rememberValue = body
        push('promise', `对方让你记住：${body}`, CONF.promise)
      }
    }

    /*
     * 习惯、边界、目标：对应槽还是备用状态，
     * 先按最接近的启用槽收下。habit/boundary 进 preference，goal 进 project。
     * 「学到的事」直接进 knowledge；它已经是启用槽，再落 event 会丢分类。
     */
    const habit = sentence.match(/我(?:的习惯是|习惯|总是|经常|每天|每周)\s*([^，。！？]{2,40})/)
    if (habit !== null && !habit[1].startsWith('不')) {
      push('preference', `对方习惯${habit[1]}`, CONF.habit)
    }

    if (/(?:我的(?:底线|边界|雷点)|别(?:再)?(?:叫|喊|碰|动|提)|不要(?:再)?(?:叫|喊|碰|动|提))/.test(sentence)) {
      push('preference', `对方的边界：${sentence}`, CONF.boundary)
    }

    const goal = sentence.match(/(?:我的目标是|我想达成|我打算|我计划|我要做到)\s*([^，。！？]{2,60})/)
    if (goal !== null) push('project', `对方的目标：${goal[1]}`, CONF.goal)

    const learned = sentence.match(/(?:我(?:学会了|学到了|才知道|刚知道|第一次知道))\s*([^，。！？]{2,60})/)
    if (learned !== null) push('knowledge', `对方学到：${learned[1]}`, CONF.learned)

    // project：正在推进的事，动作短语才收，置信度中等。
    const doing = sentence.match(/我(?:正在|在|刚在|准备|打算)(?:做|改|写|学|弄|研究|整理|开发|修)\s*([^，。！？]{2,50})/)
    if (doing !== null) {
      push('project', `对方在做${doing[1]}`, CONF.doing)
    }

    // event：带时间词的事，最轻的一档，置信度最低。
    if (/(?:最近|今天|昨天|明天|这周|下周|这个月|下个月)/.test(sentence)) {
      push('event', `对方说：${sentence}`, CONF.event)
    }

    /*
     * 显式记忆词的兜底：六类句式没接住，但用户点名要记、句子又带具体信息
     * （数字 / 日期 / 地名 / 字母串）时放行。宁可信「帮我记下周三交报告」，
     * 也不让明确指令漏掉；已经由 remember 规则接住的句子不再重复记。
     */
    if (rememberValue === null && MEMORY_WORDS.test(sentence) && CONCRETE_HINT.test(sentence)) {
      push('promise', `对方让记：${sentence}`, CONF.fallback)
    }

    if (found.length >= MAX_PER_MESSAGE) break
  }

  return found.slice(0, MAX_PER_MESSAGE)
}
