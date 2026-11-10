// 麦克风采集：能量 VAD 切句 -> 16 kHz 单声道 WAV -> 交给主进程转写。
//
// 为什么放在独立隐藏窗口里：
// - 主界面是 Live2D 画布，塞采集逻辑会把渲染循环和音频线程绑在一起。
// - 这个窗口可以被主进程单独创建、销毁，开关「常开监听」就等于关掉一个窗口。
//
// 这里不做识别，也不读配置：拿到的每一句都交给主进程判断是不是唤醒词。

const TARGET_RATE = 16000
const FRAME = 4096
/** 低于这个 RMS 当作静音；环境噪声大时会被主进程侧的阈值覆盖。 */
const MIN_RMS = 0.012
const SILENCE_MS = 700
const MIN_SPEECH_MS = 320
const MAX_SEGMENT_MS = 8000
/** 一次唤醒后静默 1.2 秒，避免同一句话被切成两段连续触发。 */
const COOLDOWN_MS = 1200

let running = false
let stream = null
let context = null
let source = null
let processor = null
let chunks = []
let speechMs = 0
let silenceMs = 0
let startedAt = 0
let lastFireAt = 0

function now() {
  return performance.now()
}

/** 线性插值重采样，够用且不引入依赖。 */
function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, input.length - 1)
    const weight = position - left
    output[index] = input[left] * (1 - weight) + input[right] * weight
  }
  return output
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
    offset += 2
  }
  return buffer
}

function concat(list) {
  const total = list.reduce((sum, item) => sum + item.length, 0)
  const output = new Float32Array(total)
  let offset = 0
  for (const item of list) {
    output.set(item, offset)
    offset += item.length
  }
  return output
}

function resetSegment() {
  chunks = []
  speechMs = 0
  silenceMs = 0
  startedAt = 0
}

async function fire(samples, rate) {
  if (samples.length < (rate * MIN_SPEECH_MS) / 1000) return
  if (now() - lastFireAt < COOLDOWN_MS) return
  lastFireAt = now()
  const mono = resample(samples, rate, TARGET_RATE)
  const wav = encodeWav(mono, TARGET_RATE)
  try {
    await window.pet.asrTranscribe(wav)
  } catch (error) {
    // 主进程重启或窗口正在关闭时会走到这里，静默即可。
    console.warn('[mic] submit failed', error)
  }
}

function onAudio(event) {
  if (!running) return
  const input = event.inputBuffer.getChannelData(0)
  const rate = context.sampleRate
  const frameMs = (input.length / rate) * 1000

  let sum = 0
  for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index]
  const rms = Math.sqrt(sum / input.length)
  const voiced = rms >= MIN_RMS

  if (voiced) {
    if (startedAt === 0) startedAt = now()
    chunks.push(new Float32Array(input))
    speechMs += frameMs
    silenceMs = 0
  } else if (startedAt !== 0) {
    chunks.push(new Float32Array(input))
    silenceMs += frameMs
  }

  const tooLong = startedAt !== 0 && now() - startedAt > MAX_SEGMENT_MS
  const finished = startedAt !== 0 && silenceMs >= SILENCE_MS && speechMs >= MIN_SPEECH_MS

  if (tooLong || finished) {
    const samples = concat(chunks)
    resetSegment()
    fire(samples, rate)
  }
}

async function start() {
  if (running) return
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  context = new AudioContext()
  if (context.state === 'suspended') await context.resume()
  source = context.createMediaStreamSource(stream)
  processor = context.createScriptProcessor(FRAME, 1, 1)
  processor.onaudioprocess = onAudio
  source.connect(processor)
  processor.connect(context.destination)
  running = true
  console.log('[mic] listening')
}

function stop() {
  running = false
  resetSegment()
  if (processor !== null) {
    processor.disconnect()
    processor.onaudioprocess = null
    processor = null
  }
  if (source !== null) {
    source.disconnect()
    source = null
  }
  if (context !== null) {
    context.close().catch(() => {})
    context = null
  }
  if (stream !== null) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  console.log('[mic] idle')
}

window.addEventListener('message', (event) => {
  const data = event.data
  if (data === null || typeof data !== 'object') return
  if (data.type === 'mic:start') start().catch(() => console.warn('[mic] start failed'))
  if (data.type === 'mic:stop') stop()
})

window.addEventListener('beforeunload', stop)

// 主进程把窗口建好后会直接加载本页；默认自动开，配置里的开关决定建不建这个窗口。
start().catch(() => console.warn('[mic] initial start failed'))
