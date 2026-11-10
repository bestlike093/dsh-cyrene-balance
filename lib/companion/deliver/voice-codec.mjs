/**
 * 语音转码：本地 TTS 吐出来的是 WAV，QQ 只收 silk。
 *
 * 这里只做一件事。失败就老实返回错误码，让上层退回文字；
 * 不抛异常，也不假装成功——语音发不出去顶多少一条，发错了更麻烦。
 */
import { encode, isSilk, isWav } from 'silk-wasm'

/** QQ 语音单条上限保守取 5MB，够念一两分钟。 */
export const MAX_VOICE_BYTES = 5 * 1024 * 1024

/** silk-wasm 的输出本身就带 `\x02#!SILK_V3` 头，QQ 要的就是这个。 */
export function looksLikeSilk(data) {
  try {
    return isSilk(data)
  } catch {
    return false
  }
}

/**
 * WAV → silk。
 *
 * sampleRate 传 0，让编码器自己从 WAV 头里读；
 * GPT-SoVITS 常见 32k/44.1k 都在它的支持表里。
 */
export async function wavToSilk(wav) {
  const buffer = Buffer.isBuffer(wav) ? wav : Buffer.from(wav ?? [])
  if (buffer.length === 0) return { ok: false, error: 'empty-audio' }
  if (buffer.length > MAX_VOICE_BYTES) return { ok: false, error: 'too-large' }
  if (!isWav(buffer)) return { ok: false, error: 'not-wav' }

  try {
    const result = await encode(buffer, 0)
    const silk = Buffer.from(result.data)
    if (!looksLikeSilk(silk)) return { ok: false, error: 'not-silk' }
    return { ok: true, silk, durationMs: Number(result.duration) || 0 }
  } catch (error) {
    return { ok: false, error: 'encode-failed', detail: String(error?.message ?? error) }
  }
}
