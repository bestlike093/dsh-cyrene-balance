/**
 * 表情系统自检。
 *
 * 用「默认模型真实存在的那 12 个 Expressions + 一组真实 Cubism 参数」
 * 造一个假模型，把 mapping / 探测 / 过渡 / neutral 归零都跑一遍。
 *
 * 只验证纯逻辑与写入行为，不启动 Electron、不加载渲染器。
 * 跑法：node scripts/expression-check.mjs
 */

import assert from 'node:assert/strict'
import {
  EXPRESSION_TAGS,
  PARAM_EXPRESSIONS,
  createExpressionController,
  normalizeEmotionTag,
  pickNativeExpression,
  probeExpressionCapability
} from '../pet/standalone/apps/desktop/electron/renderer/expression.mjs'

/** 与 Cyrene.model3.json 的 Expressions 完全一致。 */
const REAL_EXPRESSIONS = [
  { Name: '表情回正' },
  { Name: '墨镜' },
  { Name: '问号' },
  { Name: '闪耀' },
  { Name: '星星眼' },
  { Name: '圈圈眼' },
  { Name: '开心眼' },
  { Name: '拽秋千1' },
  { Name: '拽秋千2' },
  { Name: '拽秋千回正' },
  { Name: '开' },
  { Name: '关' }
]

const REAL_PARAMS = [
  'ParamMouthForm',
  'ParamMouthOpenY',
  'ParamEyeLSmile',
  'ParamEyeRSmile',
  'ParamBrowLY',
  'ParamBrowRY',
  'ParamBrowAngleL',
  'ParamBrowAngleR',
  'ParamCheek'
]

function createFakeModel({ expressions = REAL_EXPRESSIONS, params = REAL_PARAMS } = {}) {
  const allowed = new Set(params)
  const written = new Map()
  const applied = []
  const core = {
    getParameterIndex: (id) => (allowed.has(id) ? 0 : -1),
    setParameterValueById: (id, value) => {
      written.set(id, value)
    },
    getParameterValueById: (id) => written.get(id) ?? 0,
    setParameterValue: (index, value) => {
      written.set(`#${index}`, value)
    }
  }
  const model = {
    internalModel: { coreModel: core, settings: { expressions } },
    expression: (name) => applied.push(name)
  }
  return { model, written, applied }
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

// 1. 情绪归一
check('未知情绪收拢到 neutral', () => {
  assert.equal(normalizeEmotionTag('HAPPY'), 'happy')
  assert.equal(normalizeEmotionTag('  sad '), 'sad')
  assert.equal(normalizeEmotionTag('furious'), 'neutral')
  assert.equal(normalizeEmotionTag(null), 'neutral')
  assert.equal(normalizeEmotionTag(42), 'neutral')
})

// 2. 能力探测
check('探测拿到 12 个自带表情与真实参数', () => {
  const { model } = createFakeModel()
  const cap = probeExpressionCapability(model)
  assert.equal(cap.kind, 'live2d')
  assert.equal(cap.nativeExpressions.length, 12)
  assert.deepEqual(cap.param.slice().sort(), REAL_PARAMS.slice().sort())
})

// 3. 情绪 → 自带表情（按真实素材名）
check('真实素材名能对上情绪', () => {
  const { model } = createFakeModel()
  const cap = probeExpressionCapability(model)
  assert.equal(pickNativeExpression(cap, 'neutral'), '表情回正')
  assert.equal(pickNativeExpression(cap, 'happy'), '开心眼')
  assert.equal(pickNativeExpression(cap, 'excited'), '星星眼')
  assert.equal(pickNativeExpression(cap, 'surprised'), '问号')
  assert.equal(pickNativeExpression(cap, 'thinking'), '问号')
})

// 4. 语义不合时不硬塞
check('没有对应表情的情绪返回 null', () => {
  const { model } = createFakeModel()
  const cap = probeExpressionCapability(model)
  assert.equal(pickNativeExpression(cap, 'sad'), null)
  assert.equal(pickNativeExpression(cap, 'angry'), null)
  assert.equal(pickNativeExpression(cap, 'tired'), null)
})

// 5. 参数通道：sad 真的写进负值
check('sad 走参数通道并写入负值', () => {
  const { model, written } = createFakeModel()
  const handlers = []
  let clock = 0
  const controller = createExpressionController({
    getModel: () => model,
    ticker: { add: (h) => handlers.push(h), remove: () => {} },
    transitionMs: 0,
    now: () => clock
  })
  controller.refresh()

  const result = controller.apply('sad')
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'param')

  clock += 1
  for (const handler of handlers) handler()

  assert.equal(written.get('ParamMouthForm'), PARAM_EXPRESSIONS.sad.ParamMouthForm)
  assert.equal(written.get('ParamBrowLY'), PARAM_EXPRESSIONS.sad.ParamBrowLY)
})

// 6. neutral：用「表情回正」清特效，并把参数归零
check('neutral 回落到表情回正且参数归零', () => {
  const { model, written, applied } = createFakeModel()
  const handlers = []
  let clock = 0
  const controller = createExpressionController({
    getModel: () => model,
    ticker: { add: (h) => handlers.push(h), remove: () => {} },
    transitionMs: 0,
    now: () => clock
  })
  controller.refresh()

  controller.apply('sad')
  clock += 1
  for (const handler of handlers) handler()
  assert.equal(written.get('ParamMouthForm'), PARAM_EXPRESSIONS.sad.ParamMouthForm)

  const result = controller.apply('neutral')
  assert.equal(result.ok, true)
  assert.equal(result.channel, 'native')
  assert.equal(applied.at(-1), '表情回正')
  // 切到自带表情时，上一张脸留下的姿态必须归零一次。
  assert.equal(written.get('ParamMouthForm'), 0)
  assert.equal(written.get('ParamBrowLY'), 0)
})

// 7. 同一情绪重复 apply 不重播过渡
check('同一情绪重复设定不重播过渡', () => {
  const { model } = createFakeModel()
  const handlers = []
  const controller = createExpressionController({
    getModel: () => model,
    ticker: { add: (h) => handlers.push(h), remove: () => {} },
    transitionMs: 0,
    now: () => 0
  })
  controller.refresh()

  controller.apply('shy')
  const second = controller.apply('shy')
  assert.equal(second.ok, true)
  assert.equal(second.unchanged, true)
})

// 8. 没有面部参数时不假装成功（例如大肥鱼那个模型）
check('模型无表情无参数时如实返回 unsupported', () => {
  const { model } = createFakeModel({ expressions: [], params: [] })
  const controller = createExpressionController({
    getModel: () => model,
    ticker: { add: () => {}, remove: () => {} },
    transitionMs: 0,
    now: () => 0
  })
  controller.refresh()
  const result = controller.apply('happy')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsupported')
})

// 9. 没有模型时不炸
check('模型未加载时返回 no-model', () => {
  const controller = createExpressionController({
    getModel: () => null,
    ticker: { add: () => {}, remove: () => {} },
    transitionMs: 0,
    now: () => 0
  })
  const result = controller.apply('happy')
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-model')
})

// 10. 十个情绪都有定义（neutral 允许为空表，运行时动态归零）
check('情绪表覆盖全部标签', () => {
  for (const tag of EXPRESSION_TAGS) {
    assert.ok(tag in PARAM_EXPRESSIONS, `${tag} 缺少参数定义`)
  }
})

let failed = 0
for (const item of results) {
  if (item.ok) {
    console.log(`PASS  ${item.name}`)
  } else {
    failed += 1
    console.log(`FAIL  ${item.name}\n      ${item.error}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`)
if (failed > 0) process.exitCode = 1
