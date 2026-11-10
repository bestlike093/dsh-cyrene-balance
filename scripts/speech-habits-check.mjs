/**
 * 群聊共同点的回归测试。
 *
 * 三条要守住：
 * 1. 一个人反复说的词，不能当成「这群人的说法」；
 * 2. 三个人都说过，才算共同点；
 * 3. 链接、广告、刷屏不进样本。
 *
 * 跑法：node scripts/speech-habits-check.mjs
 */
import { observeText, pickPhrases } from '../pet/standalone/apps/desktop/electron/speech-habits.mjs'

const state = { version: 1, scopes: {} }
const scope = 'qq:group:123'
let clock = 1000
const say = (speaker, text) => observeText(state, scope, text, (clock += 1000), speaker)

// 张三一个人的口癖
say('zhangsan', '好家伙这也能行')
say('zhangsan', '好家伙 真行')
say('zhangsan', '好家伙 太离谱了')

// 三个人都这么说
say('zhangsan', '真的假的啊')
say('lisi', '真的假的')
say('wangwu', '真的假的吧')

// 两个人说过，还差一个人确认 → 待审
say('lisi', '整挺好这个')
say('wangwu', '整挺好')

// 不该进样本的
say('bot', 'http://spam.example.com 加群扫码领优惠')
say('bot', '哈哈哈哈哈哈哈哈')

const bucket = state.scopes[scope]
const picked = pickPhrases(bucket).map((item) => item.text)
const pending = Object.keys(bucket.pending).filter((text) => text.includes('整挺'))

const checks = [
  ['三个人都说的进共同点', picked.some((text) => text.includes('真的假'))],
  ['一个人说的被排除', !picked.some((text) => text.includes('好家'))],
  ['链接和刷屏没进样本', bucket.samples === 8],
  ['两个人的说法进了待审', pending.length > 0]
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}
console.log(`\n共同点：${picked.join('、')}`)
console.log(`待审：${pending.join('、')}`)
process.exitCode = failed === 0 ? 0 : 1
