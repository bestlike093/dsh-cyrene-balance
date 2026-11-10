/**
 * dsh-cyrene-pet/voice —— 语音模块 组件行（M4，已从主插件拆出）。
 *
 * 本行只负责「把字变成声」：
 *   - 桌面气泡 TTS（speak）：合成 + 落盘 + 推送 speechClip；
 *   - 通道语音（synthesize / toSilk）：pet-qq 行把合成与转码交给这里，
 *     自己只负责往平台发 bytes。
 *
 * 不做的事：不碰模型请求、不改别的插件的状态、不注册全局副作用；
 * 行内失败只降级自己（没配端点就回 no-endpoint，不硬凑陌生的腔调）。
 *
 * 拆分蓝图与里程碑见 docs/component-split.md（第九节 M4 执行清单）。
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { planSpeak, synthesizeSpeech } from '../companion/index.mjs'
import { wavToSilk } from '../companion/deliver/voice-codec.mjs'

export const name = 'dsh-cyrene-pet/voice'
export const inject = ['webServer', 'systemPrompt', 'cyrene/kernel']

export function apply(ctx) {
  const kernel = ctx.get('cyrene/kernel')
  if (kernel === null || kernel === undefined) {
    throw new Error('dsh-cyrene-pet/voice：cyrene/kernel 未提供，本行无法启动')
  }

  const log = (message, error) => {
    if (error === undefined) ctx.logger?.warn?.(`${name}: ${message}`)
    else ctx.logger?.warn?.(`${name}: ${message}`, error)
  }

  const SPEECH_DIR = join(kernel.stateDir, 'speech')

  /* 本行私有状态：进程内唯一写者，所有窗口共享。 */
  let speechSeq = 0
  let speechClip = null
  /* 自动开口的节流起点；与拆分前同语义（成功合成才推进）。 */
  let lastAutoSpeakAt = 0
  /* 合成失败后静默一分钟，避免每句话都等同一个超时。 */
  let localTtsVetoUntil = 0

  /**
   * 桌面气泡 TTS：合成、落盘、更新 speechClip（live.json 里给桌宠读）。
   * 失败只改 clip 状态，不抛错。
   */
  async function speak(text, reason = 'manual') {
    const safeText = kernel.filterOutboundText(text)
    if (Date.now() < localTtsVetoUntil) {
      speechClip = { seq: ++speechSeq, at: Date.now(), url: '', reason: 'cooldown' }
      return
    }
    const stateNow = kernel.readState()
    const plan = planSpeak({
      voice: {
        enabled: stateNow.speechEnabled === true,
        provider: 'local',
        localUrl: stateNow.ttsEndpoint,
        refAudioPath: stateNow.ttsRefAudio,
        promptText: stateNow.ttsPromptText,
        maxChars: 120,
        trigger: 'every',
        minIntervalSeconds: 0
      },
      quiet: null,
      text: safeText,
      reason,
      now: Date.now(),
      lastAutoSpeakAt
    })
    if (!plan.ok) {
      speechClip = { seq: ++speechSeq, at: Date.now(), url: '', reason: plan.reason }
      return
    }

    const result = await synthesizeSpeech({
      endpoint: plan.endpoint,
      text: plan.text,
      refAudioPath: plan.refAudioPath,
      promptText: plan.promptText,
      promptLang: plan.promptLang,
      timeoutMs: 20000
    })
    if (!result.ok) {
      localTtsVetoUntil = Date.now() + 60000
      speechClip = { seq: ++speechSeq, at: Date.now(), url: '', reason: result.error, detail: result.detail }
      return
    }
    localTtsVetoUntil = 0

    const hash = createHash('sha1').update(plan.text).digest('hex').slice(0, 16)
    try {
      await mkdir(SPEECH_DIR, { recursive: true })
    } catch (error) {
      log(`合成落盘目录建不出来：${String(error?.message ?? error)}`)
      return
    }
    const file = join(SPEECH_DIR, `${hash}.wav`)
    await writeFile(file, result.audio)
    if (plan.autoSpeakAt !== null) lastAutoSpeakAt = plan.autoSpeakAt
    speechClip = { seq: ++speechSeq, at: Date.now(), url: pathToFileURL(file).href, text: plan.text }
  }

  /** live.json 用的当前 clip；没有就 null。 */
  function currentClip() {
    return speechClip
  }

  /** 设置里的 TTS 端点 / 参考音频被改过：清掉失败冷却，下一次立刻试新配置。 */
  function resetVeto() {
    localTtsVetoUntil = 0
  }

  /** 通道语音合成：纯 passthrough，平台行（pet-qq / 将来的 pet-wechat）拿 bytes 自己发。 */
  function synthesize({ endpoint, text, refAudioPath, promptText = '', promptLang, timeoutMs = 30000 }) {
    return synthesizeSpeech({ endpoint, text, refAudioPath, promptText, promptLang, timeoutMs })
  }

  /** wav → silk（QQ 收 silk；微信侧再按平台格式转）。 */
  function toSilk(bytes) {
    return wavToSilk(bytes)
  }

  ctx.provide('cyrene/voice', {
    speak,
    currentClip,
    resetVeto,
    synthesize,
    toSilk,
  })
}
