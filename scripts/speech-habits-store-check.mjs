/**
 * 学习层的接口测试：待审、裁决、总开关、脏话拦截。
 * 跑法：node scripts/speech-habits-store-check.mjs
 */
import { createSpeechHabitStore } from '../pet/standalone/apps/desktop/electron/speech-habits.mjs'

const store = createSpeechHabitStore({ filePath: null, now: () => 1_000_000 })
await store.load()
const scope = 'qq:group:9'

// 三个人都说
store.observe(scope, '真的假的啊', 'a')
store.observe(scope, '真的假的', 'b')
store.observe(scope, '真的假的吧', 'c')

// 两个人说
store.observe(scope, '整挺好这个', 'b')
store.observe(scope, '整挺好', 'c')

const before = store.snapshot(scope).samples
// 骂人和广告不该被听进去
store.observe(scope, '操你妈的', 'd')
store.observe(scope, '傻逼东西', 'e')
const after = store.snapshot(scope).samples

// 主人把「整挺好」留下
const listedBefore = store.list(scope)
const resolved = store.resolve(scope, '整挺好', true)
const listed = store.list(scope)

// 关掉总开关后不再统计
store.setLearning(false)
const offBefore = store.snapshot(scope).samples
store.observe(scope, '这句话应该被忽略掉', 'f')
const offAfter = store.snapshot(scope).samples

const checks = [
  ['三个人的说法进了共同点', listed.adopted.some((item) => item.text.includes('真的假'))],
  ['两个人的说法在待审里', listedBefore.pending.some((item) => item.text.includes('整挺'))],
  ['裁决成功后从待审消失', resolved.ok === true && !listed.pending.some((item) => item.text.includes('整挺好'))],
  ['脏话没进样本', before === after],
  ['关掉开关后不再统计', offBefore === offAfter]
]

let failed = 0
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
  if (!ok) failed += 1
}
console.log(`\n共同点：${listed.adopted.map((item) => item.text).join('、')}`)
console.log(`待审：${listed.pending.map((item) => item.text).join('、') || '（空）'}`)
process.exitCode = failed === 0 ? 0 : 1
