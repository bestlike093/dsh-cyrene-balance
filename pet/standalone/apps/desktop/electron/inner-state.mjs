/**
 * 内心状态评估：隔几轮让模型回头看一眼，自己更新「好感、印象、关系」和记忆事实。
 *
 * 为什么单独做一次调用：
 * - 聊天本身要快、要自然，不适合在回复里夹带 JSON；
 * - 状态更新的频率远低于对话，攒够几轮再算一次，成本可控；
 * - 失败就等下一轮，不写半份状态，也不打扰正在聊天的人。
 */
import { classifyMemory, detectCorrection } from './social.mjs'

const EVAL_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const EVAL_TIMEOUT_MS = 30_000

const SYSTEM_PROMPT = [
  '你在为一个桌面陪伴角色整理「内心状态」。只输出一个 JSON 对象，不要解释。',
  '格式：{"favor":42,"impression":"怎么看这个人","relation":"现在是什么关系","read":"对方刚才的态度","adjust":"下次说话要注意什么","facts":[{"kind":"preference","text":"以后还用得上的事实","supersedes":"被这句话推翻的旧事实，没有就省略","mentionPolicy":"free / soft_echo / on_request / never，看情况省略"}]}',
  '规则：',
  '- favor 是 0 到 100 的整数，代表你对这个人的整体好感；一次只挪一点，不因一句奉承暴涨；',
  '- 对方敷衍、失约、说话伤人时，favor 可以往下走，跌破 20 就是「疏远」，不必一直维持礼貌的热情；',
  '- 对方认真回应、记得你说过的话、在难受时陪着你，favor 可以慢慢往上，别一次加太多；',
  '- impression 不超过 40 字，写具体的看法，不写空话；',
  '- relation 不超过 20 字，写你们现在的关系，例如「刚认识，还在试探」；',
  '- read 不超过 30 字，只写这几轮里看得出来的态度：认真、敷衍、开玩笑、烦躁、在试探、想被陪；看不出来就省略这个字段；',
  '- adjust 不超过 40 字，写「下次自己该怎么说」：句子长短、要不要追问、该不该撒娇、哪些话别再说；只写一条，别写成清单；',
  '- facts 只写以后还会用到的：偏好、人物、项目、约定、被纠正过的地方；寒暄和一时情绪不要写；',
  '- kind 只能是 preference / person / project / promise / lesson；每条不超过 40 字；',
  '- 对方指出你说错了、不该这样说、下次要怎样时，写成 kind=lesson，text 用「对方纠正过：……」开头，不要写成辩解；',
  '- 对方改口时（「我不喜欢咖啡了」「现在换成周末」），在新 fact 里用 supersedes 抄回被推翻的旧说法原文；只是补充细节就省略这个字段；',
  '- 提及尺度分四档：随时能直说就省略；只适合放在语气里、不方便摊开说的（对方还没准备好聊、或说了会让气氛变重）写 soft_echo；涉及身体、家庭、财务、感情或别人隐私的写 on_request；对方明确说过「别跟别人讲」的写 never；',
  '- 如果这段对话发生在 QQ 上，不要把 QQ 里的人当成此刻坐在电脑前的人；',
  '- 没有值得留下的 fact 就给空数组。'
].join('\n')

/** 从模型输出里取 JSON；解析不了返回 null。 */
export function extractInnerJson(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '') return null
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced === null ? text : fenced[1]
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1))
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** 只保留模型确实给出的字段，缺的不补、不猜。 */
export function normalizeEvaluation(parsed) {
  if (parsed === null || typeof parsed !== 'object') return null
  const favor = Number(parsed.favor)
  const result = {}
  if (Number.isFinite(favor)) result.favor = Math.min(100, Math.max(0, Math.round(favor)))
  if (typeof parsed.impression === 'string' && parsed.impression.trim() !== '') {
    result.impression = parsed.impression.trim().slice(0, 120)
  }
  if (typeof parsed.relation === 'string' && parsed.relation.trim() !== '') {
    result.relation = parsed.relation.trim().slice(0, 120)
  }
  if (typeof parsed.read === 'string' && parsed.read.trim() !== '') {
    result.read = parsed.read.trim().slice(0, 60)
  }
  if (typeof parsed.adjust === 'string' && parsed.adjust.trim() !== '') {
    result.adjust = parsed.adjust.trim().slice(0, 80)
  }
  const facts = Array.isArray(parsed.facts) ? parsed.facts : []
  result.facts = facts
    .filter((item) => item !== null && typeof item === 'object' && typeof item.text === 'string')
    .map((item) => {
      const fact = {
        kind: ['preference', 'person', 'project', 'promise', 'lesson'].includes(item.kind)
          ? item.kind
          : 'preference',
        text: item.text.trim().slice(0, 160)
      }
      // 改口证据只透传原文，不在这里判断真假；是否归档旧条目交给记忆层。
      if (typeof item.supersedes === 'string' && item.supersedes.trim() !== '') {
        fact.supersedes = item.supersedes.trim().slice(0, 160)
      }
      if (['free', 'soft_echo', 'on_request', 'never'].includes(item.mentionPolicy)) {
        fact.mentionPolicy = item.mentionPolicy
      }
      return fact
    })
    .filter((item) => item.text !== '')
    .slice(0, 8)
  if (result.favor === undefined && result.impression === undefined && result.relation === undefined) {
    return null
  }
  return result
}

function readEvalConfig(settings) {
  const chat = settings?.companion?.chat ?? {}
  return {
    provider:
      typeof chat.provider === 'string' && chat.provider.trim() !== '' ? chat.provider.trim() : 'deepseek',
    model: typeof chat.model === 'string' && chat.model.trim() !== '' ? chat.model.trim() : 'deepseek-chat'
  }
}

/**
 * @param {object} options
 * @param {() => object} options.getSettings
 * @param {() => Promise<string|null>} options.getApiKey
 * @param {object} options.relationship  affinity 实例
 * @param {object} options.facts         memory-facts 实例
 * @param {() => number} [options.now]
 * @param {Function} [options.fetchImpl]
 * @param {(message: string, error?: unknown) => void} [options.log]
 * @param {number} [options.minTurns]
 */
export function createInnerStateService(options = {}) {
  const {
    getSettings = () => ({}),
    getApiKey = async () => null,
    relationship,
    facts,
    now = Date.now,
    fetchImpl = globalThis.fetch,
    log = () => {},
    minTurns = 6
  } = options

  const inflight = new Map()
  let lastAttemptAt = 0

  function enabled() {
    const layer = getSettings()?.companion?.companionLayer
    return layer?.enabled !== false
  }

  /**
   * 攒够几轮就评估一次。调用方不必 await；这里自己吞掉所有失败。
   * 每个作用域各算各的：QQ 聊满六轮，不会顺带把桌面的好感也重算一遍。
   */
  function maybeUpdate(scope = 'desktop') {
    const key = typeof scope === 'string' && scope.trim() !== '' ? scope.trim() : 'desktop'
    if (!enabled()) return { ok: false, reason: 'disabled' }
    if (relationship === undefined || facts === undefined) return { ok: false, reason: 'no-store' }
    if (inflight.has(key)) return { ok: false, reason: 'inflight' }

    const pending =
      typeof relationship.pendingTurns === 'function' ? relationship.pendingTurns(key) : []
    if (pending.length < minTurns) return { ok: false, reason: 'not-enough', count: pending.length }

    const task = (async () => {
      try {
        const config = readEvalConfig(getSettings())
        if (config.provider !== 'deepseek') return { ok: false, reason: 'unsupported-provider' }

        let apiKey = null
        try {
          apiKey = await getApiKey()
        } catch (error) {
          return { ok: false, reason: 'vault-unavailable', message: String(error?.message ?? error) }
        }
        if (apiKey === null || apiKey === '') return { ok: false, reason: 'no-key' }

        const current =
          typeof relationship.snapshot === 'function' ? relationship.snapshot(key) : {}
        const known =
          typeof facts.rank === 'function' ? facts.rank('', 10, now(), key) : []
        const transcript = pending
          .map((item) => `对方：${item.user}\n你：${item.assistant}`)
          .join('\n')

        const userContent = [
          key === 'desktop'
            ? '这段对话发生在桌面窗口，对方就是此刻坐在电脑前的人。'
            : `这段对话来自 QQ（${key}），回话会被转回 QQ，不要把对方当成此刻坐在电脑前的人。`,
          `现在的内心状态：好感 ${current.favor ?? 0}/100；印象「${current.impression || '还没有'}」；关系「${current.relation || '还不熟'}」。`,
          current.adjust
            ? `上次你提醒自己：${current.adjust}。这次看看有没有做到，没做到就换一条更具体的。`
            : '上次还没有留下对自己的提醒。',
          known.length > 0
            ? `已经记得的事：\n${known.map((fact) => `- [${fact.kind}] ${fact.text}`).join('\n')}`
            : '还没有留下什么记忆。',
          `最近这几轮对话：\n${transcript}`,
          '请根据这些内容，更新内心状态，并给出值得留下的新事实。'
        ].join('\n\n')

        const controller = new AbortController()
        let timer = null
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(Object.assign(new Error('inner state timeout'), { code: 'timeout' }))
          }, EVAL_TIMEOUT_MS)
          timer.unref?.()
        })

        try {
          const response = await Promise.race([
            fetchImpl(EVAL_ENDPOINT, {
              method: 'POST',
              signal: controller.signal,
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
              },
              body: JSON.stringify({
                model: config.model,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user', content: userContent }
                ],
                temperature: 0.3,
                max_tokens: 500,
                stream: false
              })
            }),
            timeout
          ])

          if (!response.ok) return { ok: false, reason: 'http', status: response.status }
          const payload = await response.json()
          const raw = payload?.choices?.[0]?.message?.content ?? ''
          const evaluation = normalizeEvaluation(extractInnerJson(raw))
          if (evaluation === null) return { ok: false, reason: 'bad-json' }

          relationship.applyEvaluation(
            {
              favor: evaluation.favor,
              impression: evaluation.impression,
              relation: evaluation.relation,
              read: evaluation.read,
              adjust: evaluation.adjust
            },
            key
          )
          // 模型给的事实再过一道闸门：寒暄、临时状态、玩笑、转述和凭据不落盘。
          // 模型已经分好 kind，这里只挡明显不该记的，不拿「信息量低」误杀项目进展。
          const blocked = new Set([
            'empty',
            'greeting',
            'temporary',
            'joke',
            'secret',
            'quoted_other',
            'roleplay',
            'explicit_forget'
          ])
          const accepted = evaluation.facts
            .filter((fact) => !blocked.has(classifyMemory(fact.text, { minLength: 3 }).reason))
            // 来源记成这一轮所属的会话，设置页才能说清「这条是从哪儿听来的」。
            .map((fact) => ({
              ...fact,
              source: typeof fact.source === 'string' && fact.source !== '' ? fact.source : key
            }))
          // 规则层兜底：模型可能把「你刚才说错了」当成普通聊天漏掉。
          // 这里只认明确纠错句式，命中就记一条 lesson，让下一轮提示词能提醒不要重犯。
          const corrections = pending
            .map((item) => detectCorrection(item.user))
            .filter((found) => found.corrected)
            .map((found) => ({
              kind: 'lesson',
              text: found.text,
              confidence: 0.9,
              source: key
            }))
          const incoming = [...accepted, ...corrections]
          if (incoming.length > 0 && typeof facts.upsert === 'function') {
            facts.upsert(incoming, now(), key)
          }
          log(
            `内心状态已更新：好感 ${evaluation.favor ?? current.favor}，新记忆 ${incoming.length} 条` +
              (accepted.length < evaluation.facts.length ? `（挡下 ${evaluation.facts.length - accepted.length} 条）` : '') +
              (corrections.length > 0 ? `（纠正 ${corrections.length} 条）` : '')
          )
          return { ok: true, evaluation }
        } finally {
          if (timer !== null) clearTimeout(timer)
        }
      } catch (error) {
        log('内心状态评估失败，等下一轮', error)
        return { ok: false, reason: 'error', message: String(error?.message ?? error) }
      } finally {
        lastAttemptAt = now()
        inflight.delete(key)
      }
    })()

    inflight.set(key, task)
    return { ok: true, started: true }
  }

  return { maybeUpdate, lastAttemptAt: () => lastAttemptAt }
}
