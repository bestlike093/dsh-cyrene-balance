import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  analyzeCapability,
  capabilityOf,
  expressionNames,
  isCatalogLike,
  motionGroupNames,
  motionNames,
  paramBounds,
  parseCatalog,
  posePresetFor,
  posePresetNames,
  resolveExpression,
  resolveMotion,
} from '../lib/companion/assets/live2d-catalog.mjs'
import {
  buildExpressionCommand,
  buildGazeCommand,
  buildMotionCommand,
  buildPoseCommand,
  buildSayCommand,
  buildStopCommand,
  buildTypingCommand,
  clampParams,
} from '../lib/companion/assets/live2d-command.mjs'
import { parseMotionTag } from '../lib/companion/voice-out/motion-tag.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL_CATALOG = JSON.parse(
  readFileSync(join(HERE, '..', 'pet', 'live2d', 'live2d-driver', 'data', 'catalog.json'), 'utf8')
)

function fakeCatalog() {
  return {
    driver: 'castorice-l2d-driver/0.1.0',
    model: '/model/test.model3.json',
    parameters: [
      { index: 0, id: 'ParamEyeLOpen', min: 0, max: 1, def: 1 },
      { index: 1, id: 'ParamEyeBallX', min: -1, max: 1, def: 0 },
      { index: 2, id: 'ParamAngleX', min: -30, max: 30, def: 0 },
    ],
    expressions: [
      { index: 0, name: '微笑', file: 'expressions/e0.exp3.json' },
      { index: 1, name: '惊讶', file: 'expressions/e1.exp3.json' },
    ],
    motionGroups: {
      小动作: [
        { index: 0, name: '点头', file: 'motions/nod.motion3.json' },
        { index: 1, name: '挥手', file: 'motions/wave.motion3.json' },
      ],
    },
    groups: [{ target: 'Parameter', name: 'EyeBlink', ids: ['ParamEyeLOpen'] }],
    hitAreas: [],
  }
}

test('catalog：真实模型目录解析出 31 表情、11 动作、236 参数', () => {
  assert.equal(isCatalogLike(REAL_CATALOG), true)
  assert.equal(REAL_CATALOG.parameters.length, 236)
  assert.equal(expressionNames(REAL_CATALOG).length, 31)
  assert.equal(motionNames(REAL_CATALOG).length, 11)
  assert.equal(motionGroupNames(REAL_CATALOG).length, 5)
  const cap = capabilityOf(REAL_CATALOG)
  assert.equal(cap.level, 4)
  assert.equal(cap.levelLabel, '丰富')
})

test('catalog：JSON 字符串与对象都能解析，垃圾输入返回 null', () => {
  const fake = fakeCatalog()
  assert.ok(parseCatalog(JSON.stringify(fake)))
  assert.ok(parseCatalog(fake))
  assert.equal(parseCatalog('not-json'), null)
  assert.equal(parseCatalog({ parameters: [], expressions: [] }), null)
  assert.equal(parseCatalog(null), null)
})

test('catalog：能力重算与驱动同口径（假模型只有眼睛与头部）', () => {
  const cap = analyzeCapability(fakeCatalog())
  assert.equal(cap.level, 2)
  assert.equal(cap.levelLabel, '单薄')
  assert.deepEqual(cap.present.eyes, ['ParamEyeLOpen'])
  assert.deepEqual(cap.present.eyeBall, ['ParamEyeBallX'])
  assert.deepEqual(cap.present.arms, [])
  assert.ok(cap.cannot.includes('挥手、抱臂'))
})

test('catalog：表情按名/下标解析，找不到返回 null', () => {
  const fake = fakeCatalog()
  assert.equal(resolveExpression(fake, '微笑')?.file, 'expressions/e0.exp3.json')
  assert.equal(resolveExpression(fake, 1)?.name, '惊讶')
  assert.equal(resolveExpression(fake, '不存在'), null)
  assert.equal(resolveExpression(fake, null), null)
})

test('catalog：动作按名解析出组名与下标', () => {
  const fake = fakeCatalog()
  const hit = resolveMotion(fake, '点头')
  assert.equal(hit.group, '小动作')
  assert.equal(hit.index, 0)
  assert.equal(resolveMotion(fake, '转圈'), null)
})

test('catalog：姿势预设只保留模型认识的参数', () => {
  const fake = fakeCatalog()
  // shy 预设全是不认识的眉毛/嘴/脸颊参数 → 一个都不认识，返回 null
  assert.equal(posePresetFor(fake, 'shy'), null)
  const lookLeft = posePresetFor(fake, 'lookLeft')
  assert.equal(lookLeft.ParamEyeBallX, -0.9)
  assert.equal(lookLeft.ParamAngleX, -18)
  assert.deepEqual(posePresetNames(), ['angry', 'sad', 'shy', 'surprise', 'sleepy', 'lookLeft', 'lookRight'])
})

test('命令：参数钳制越界裁到 min/max，未知参数丢弃', () => {
  const fake = fakeCatalog()
  const out = clampParams(fake, { ParamEyeLOpen: 5, ParamEyeBallX: -9, ParamAngleX: 100, NoSuchParam: 1 })
  assert.equal(out.ParamEyeLOpen, 1)
  assert.equal(out.ParamEyeBallX, -1)
  assert.equal(out.ParamAngleX, 30)
  assert.equal('NoSuchParam' in out, false)
})

test('命令：说话命令截长、可选尾巴编错静默丢弃', () => {
  const fake = fakeCatalog()
  const say = buildSayCommand(fake, '你好', { expression: '惊讶', motion: '点头', pose: 'lookLeft' })
  assert.equal(say.cmd, 'say')
  assert.equal(say.text, '你好')
  assert.equal(say.expression, '惊讶')
  assert.equal(say.motion.group, '小动作')
  assert.deepEqual(say.pose, { ParamEyeBallX: -0.9, ParamAngleX: -18 })
  const long = buildSayCommand(fake, 'x'.repeat(1000))
  assert.equal(long.text.length, 400)
  const bogus = buildSayCommand(fake, '你好', { expression: '不存在', motion: '不存在' })
  assert.equal('expression' in bogus, false)
  assert.equal('motion' in bogus, false)
})

test('命令：表情/动作/姿势/视线命令形状', () => {
  const fake = fakeCatalog()
  assert.equal(buildExpressionCommand(fake, '微笑', 30000).name, '微笑')
  assert.equal(buildExpressionCommand(fake, '不存在'), null)
  assert.equal(buildMotionCommand(fake, '点头').group, '小动作')
  assert.equal(buildMotionCommand(fake, '转圈'), null)
  assert.deepEqual(buildPoseCommand(fake, 'lookLeft', 100).duration, 500)
  assert.deepEqual(buildPoseCommand(fake, 'lookLeft', 999999).duration, 120000)
  assert.equal(buildPoseCommand(fake, '不存在的姿势'), null)
  assert.deepEqual(buildGazeCommand(2, -3), { cmd: 'gaze', x: 1, y: -1 })
  assert.deepEqual(buildTypingCommand(), { cmd: 'typing', on: true })
  assert.deepEqual(buildStopCommand(), { cmd: 'stop' })
})

test('动作标签：三种括号都认，先摘标记再判合法', () => {
  const allowed = ['点头', '挥手']
  const a = parseMotionTag('来啦 [动作:点头] 今天天气不错', allowed)
  // 标记整段摘掉后两侧空格各留一个，与 emoji-tag 同款行为
  assert.equal(a.text, '来啦  今天天气不错')
  assert.equal(a.motion, '点头')
  const b = parseMotionTag('【动作：挥手】嗨', allowed)
  assert.equal(b.motion, '挥手')
  const c = parseMotionTag('(动作: 挥手)嗨', allowed)
  assert.equal(c.motion, '挥手')
  // 编出不存在的动作名：标记摘掉，动作不给
  const d = parseMotionTag('你好 [动作:后空翻] 再见', allowed)
  assert.equal(d.text, '你好  再见')
  assert.equal(d.motion, null)
  // 没给白名单时不校验
  const e = parseMotionTag('你好 [动作:后空翻]', null)
  assert.equal(e.motion, '后空翻')
  // 非字符串
  assert.deepEqual(parseMotionTag(null), { text: '', motion: null })
})
