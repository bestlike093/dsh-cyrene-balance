/**
 * 自检：WAV 能不能真的编成 QQ 认的 silk。
 *
 * 不连网络、不启动 Electron，直接跑 node scripts/voice-codec-check.mjs。
 */
import { wavToSilk, looksLikeSilk, MAX_VOICE_BYTES } from '../lib/companion/deliver/voice-codec.mjs'

function makeWav(sampleRate = 24000, seconds = 1) {
  const samples = Math.trunc(sampleRate * seconds)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

for (const rate of [16000, 24000, 32000, 44100]) {
  const wav = makeWav(rate, 1)
  const encoded = await wavToSilk(wav)
  check(
    `wav ${rate}Hz → silk`,
    encoded.ok === true && looksLikeSilk(encoded.silk) && encoded.durationMs > 0,
    encoded.ok ? `${encoded.silk.length} bytes / ${Math.round(encoded.durationMs)}ms` : encoded.error
  )
}

const bad = await wavToSilk(Buffer.from('not a wav at all'))
check('非 WAV 被拒绝', bad.ok === false && bad.error === 'not-wav', bad.error ?? '')

const empty = await wavToSilk(Buffer.alloc(0))
check('空音频被拒绝', empty.ok === false && empty.error === 'empty-audio', empty.error ?? '')

const huge = await wavToSilk(Buffer.alloc(MAX_VOICE_BYTES + 1))
check('超限被拒绝', huge.ok === false && huge.error === 'too-large', huge.error ?? '')

const failed = results.filter((item) => !item.ok)
for (const item of results) {
  console.log(`${item.ok ? 'ok  ' : 'FAIL'} ${item.name}${item.detail === '' ? '' : ` — ${item.detail}`}`)
}
console.log(`\n${failed.length === 0 ? 'ok:true' : `ok:false (${failed.length} failed)`}`)
process.exitCode = failed.length === 0 ? 0 : 1
