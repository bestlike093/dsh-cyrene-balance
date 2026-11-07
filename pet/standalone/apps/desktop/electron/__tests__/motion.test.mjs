import { describe, expect, it } from 'vitest'
import {
  ACTION_TABLE,
  MOOD_ACTIONS,
  createMotionController,
  envelope,
  hasParameter,
  normalizeName,
  probeMotionCapability,
  resolveActionKey,
  sampleTrack,
  scoreName,
  writeParameter
} from '../renderer/motion.mjs'

/** 假 ticker：把回调攥在手里，测试自己决定什么时候推进，不依赖 rAF。 */
function fakeTicker() {
  const handlers = new Set()
  return {
    handlers,
    add: (fn) => handlers.add(fn),
    remove: (fn) => handlers.delete(fn),
    tick: () => {
      for (const fn of [...handlers]) fn()
    }
  }
}

/** 只有 Pixi 变换能力的假模型（静态立绘 / 帧序列就是这种）。 */
function fakeDisplayObject() {
  const state = { x: 10, y: 20, sx: 1, sy: 1, rot: 0 }
  return {
    state,
    texture: {},
    position: {
      get x() {
        return state.x
      },
      get y() {
        return state.y
      },
      set x(value) {
        state.x = value
      },
      set y(value) {
        state.y = value
      },
      set(x, y) {
        state.x = x
        state.y = y
      }
    },
    scale: {
      get x() {
        return state.sx
      },
      get y() {
        return state.sy
      },
      set(sx, sy) {
        state.sx = sx
        state.sy = sy
      }
    },
    get rotation() {
      return state.rot
    },
    set rotation(value) {
      state.rot = value
    },
    getBounds: () => ({ height: 120 })
  }
}

describe('resolveActionKey', () => {
  it('认得英文 key、中文别名和大小写混写', () => {
    expect(resolveActionKey('bounce')).toBe('bounce')
    expect(resolveActionKey('开心')).toBe('bounce')
    expect(resolveActionKey('点头')).toBe('nod')
    expect(resolveActionKey('  Shake ')).toBe('shake')
  })

  it('编不出来的名字返回 null，不硬凑一个最像的', () => {
    expect(resolveActionKey('后空翻')).toBeNull()
    expect(resolveActionKey('')).toBeNull()
    expect(resolveActionKey(null)).toBeNull()
  })

  it('动作表里每个 key 都能被自己解析回来', () => {
    for (const key of Object.keys(ACTION_TABLE)) {
      expect(resolveActionKey(key)).toBe(key)
    }
  })

  it('每个心情档位的候选动作都在动作表里', () => {
    for (const [level, keys] of Object.entries(MOOD_ACTIONS)) {
      expect(keys.length).toBeGreaterThan(0)
      for (const key of keys) {
        expect(ACTION_TABLE[key], `${level} → ${key}`).toBeDefined()
      }
    }
  })
})

describe('scoreName / normalizeName', () => {
  it('归一化忽略空格、下划线和大小写', () => {
    expect(normalizeName('Tap Body')).toBe('tapbody')
    expect(normalizeName('tap_body')).toBe('tapbody')
    expect(scoreName('tapbody', 'Tap Body')).toBe(100)
  })

  it('空串不匹配任何东西', () => {
    expect(scoreName('', 'idle')).toBe(0)
    expect(scoreName('idle', '')).toBe(0)
  })
})

describe('曲线采样', () => {
  it('包络两端归零，动作不会硬起硬停', () => {
    expect(envelope(0)).toBe(0)
    expect(envelope(1)).toBe(0)
    expect(envelope(0.5)).toBeGreaterThan(0.9)
    expect(envelope(-0.1)).toBe(0)
    expect(envelope(NaN)).toBe(0)
  })

  it('amp 为 0 的轨道恒等于 base', () => {
    expect(sampleTrack({ id: 'x', amp: 0, cycles: 0 }, 0.37)).toBe(0)
    expect(sampleTrack({ id: 'x', amp: 0, cycles: 0, base: 0.5 }, 0.37)).toBe(0.5)
  })

  it('t=0 时值是 base，不会一上来就跳', () => {
    expect(sampleTrack({ id: 'ParamAngleX', amp: 20, cycles: 2 }, 0)).toBeCloseTo(0, 6)
    expect(sampleTrack({ id: 'ParamEyeLOpen', amp: -0.5, cycles: 1, base: 0.5 }, 0)).toBeCloseTo(0.5, 6)
  })
})

describe('probeMotionCapability', () => {
  it('没有模型时如实报 none，不编能力', () => {
    expect(probeMotionCapability(null)).toMatchObject({ kind: 'none', native: [], param: [], pixi: false })
  })

  it('素材自带 motion 时列出 group 与下标', () => {
    const cap = probeMotionCapability({
      internalModel: {
        motionManager: { definitions: { Idle: [{ File: 'a.mtn' }, { File: 'b.mtn' }] } },
        coreModel: { getParameterIndex: () => -1 }
      },
      position: {},
      scale: {},
      rotation: 0
    })
    expect(cap.kind).toBe('live2d')
    expect(cap.native).toHaveLength(2)
    expect(cap.native[0]).toMatchObject({ group: 'Idle', index: 0, name: 'a.mtn', channel: 'native' })
    expect(cap.param).toEqual([])
    expect(cap.pixi).toBe(true)
  })

  it('素材没有动作定义时 native 为空 —— 这是实测到的真实情况', () => {
    const cap = probeMotionCapability({
      internalModel: { motionManager: { definitions: {}, groups: { idle: 'Idle' } }, coreModel: {} },
      position: {},
      scale: {},
      rotation: 0
    })
    expect(cap.native).toEqual([])
    expect(cap.nativeExpressions).toEqual([])
  })

  it('只把真存在的 Cubism 参数算进能力', () => {
    const cap = probeMotionCapability({
      internalModel: {
        motionManager: { definitions: {} },
        coreModel: {
          getParameterIndex: (id) => (id === 'ParamAngleX' ? 3 : -1)
        }
      },
      position: {},
      scale: {},
      rotation: 0
    })
    expect(cap.param).toContain('ParamAngleX')
    expect(cap.param).not.toContain('ParamAngleZ')
  })
})

describe('hasParameter / writeParameter', () => {
  it('getParameterIndex 抛异常时判为没有', () => {
    expect(
      hasParameter({
        getParameterIndex: () => {
          throw new Error('boom')
        }
      }, 'ParamAngleX')
    ).toBe(false)
  })

  it('三种运行时 API 都能写进去', () => {
    const calls = []
    expect(writeParameter({ setParameterValueById: (id, v) => calls.push(['byId', id, v]) }, 'P', 1)).toBe(true)
    expect(
      writeParameter(
        { getParameterIndex: () => 2, setParameterValue: (i, v) => calls.push(['byIndex', i, v]) },
        'P',
        2
      )
    ).toBe(true)
    expect(writeParameter({ setParamFloat: (id, v) => calls.push(['float', id, v]) }, 'P', 3)).toBe(true)
    expect(calls).toEqual([
      ['byId', 'P', 1],
      ['byIndex', 2, 2],
      ['float', 'P', 3]
    ])
  })

  it('写入抛异常时返回 false，让调用方降级而不是崩掉', () => {
    expect(
      writeParameter({
        setParameterValueById: () => {
          throw new Error('no such param')
        }
      }, 'P', 1)
    ).toBe(false)
    expect(writeParameter(null, 'P', 1)).toBe(false)
  })
})

describe('createMotionController', () => {
  it('没有模型时明确报 no-model', () => {
    const controller = createMotionController({ getModel: () => null })
    expect(controller.play('nod')).toEqual({ ok: false, reason: 'no-model' })
  })

  it('认不出的动作名报 unknown-action，不假装播了', () => {
    const model = fakeDisplayObject()
    const controller = createMotionController({ getModel: () => model })
    expect(controller.play('飞天')).toEqual({ ok: false, reason: 'unknown-action' })
  })

  it('只有 Pixi 变换能力时走 pixi 通道，并且逐帧真的动了', () => {
    const model = fakeDisplayObject()
    const ticker = fakeTicker()
    let at = 0
    const controller = createMotionController({ getModel: () => model, ticker, now: () => at })
    const result = controller.play('bounce', { source: 'test' })
    expect(result).toEqual({ ok: true, channel: 'pixi', key: 'bounce' })

    // 时钟写死在起始点只会采到包络为 0 的那一帧，所以这里真的推进时间。
    const frames = new Set()
    const duration = ACTION_TABLE.bounce.duration
    for (let t = 0; t <= duration; t += 60) {
      at = t
      ticker.tick()
      frames.add(`${model.state.x}|${model.state.y}|${model.state.rot}|${model.state.sx}`)
    }
    expect(frames.size).toBeGreaterThan(1)
    // 再推一帧越过终点，才会走到收尾还原那一步。
    at = duration + 100
    ticker.tick()
    expect(model.state.x).toBe(10)
    expect(model.state.y).toBe(20)
    expect(model.state.rot).toBe(0)
    expect(model.state.sx).toBe(1)
    expect(ticker.handlers.size).toBe(0)
  })

  it('播完把位置、缩放、旋转全部还原到基线', () => {
    const model = fakeDisplayObject()
    model.state.rot = 0.3
    const ticker = fakeTicker()
    let at = 0
    const controller = createMotionController({
      getModel: () => model,
      ticker,
      now: () => at
    })
    controller.play('shake', { source: 'test' })
    at = 100
    ticker.tick()
    expect(model.state.x).not.toBe(10)
    at = 10_000
    ticker.tick()
    expect(model.state.x).toBe(10)
    expect(model.state.y).toBe(20)
    expect(model.state.rot).toBeCloseTo(0.3, 6)
    expect(model.state.sx).toBe(1)
    expect(controller.activeKey).toBeNull()
    // 结束后 ticker 上不留回调，避免一直空转。
    expect(ticker.handlers.size).toBe(0)
  })

  it('正在播的时候再点，如实报 busy 而不是叠两个动画', () => {
    const model = fakeDisplayObject()
    const ticker = fakeTicker()
    const controller = createMotionController({ getModel: () => model, ticker, now: () => 1000 })
    expect(controller.play('nod').ok).toBe(true)
    expect(controller.play('tilt')).toEqual({ ok: false, reason: 'busy' })
  })

  it('动作收尾后仍在冷却期内不重复播，换动作与冷却过期都放行', () => {
    const model = fakeDisplayObject()
    const ticker = fakeTicker()
    const nodDuration = ACTION_TABLE.nod.duration
    const tiltDuration = ACTION_TABLE.tilt.duration
    const cooldownMs = (nodDuration + tiltDuration) * 2
    let at = 0
    const controller = createMotionController({
      getModel: () => model,
      ticker,
      cooldownMs,
      now: () => at
    })
    expect(controller.play('nod').ok).toBe(true)

    // 落在「动作已结束、冷却还没过」的窗口里：靠冷却挡住，不靠 active。
    at = nodDuration * 2
    ticker.tick()
    expect(controller.activeKey).toBeNull()
    expect(cooldownMs).toBeGreaterThan(at)
    expect(controller.play('nod')).toEqual({ ok: false, reason: 'busy' })
    expect(controller.play('tilt').ok).toBe(true)

    // 冷却过期后同一个动作又能播。
    at = cooldownMs + nodDuration * 2 + tiltDuration * 2 + 1
    ticker.tick()
    expect(controller.play('nod').ok).toBe(true)
  })

  it('素材自带 motion 时优先走 native，并调用素材自己的动作', () => {
    const calls = []
    const model = {
      internalModel: {
        motionManager: { definitions: { Tap: [{ File: 'tap_body.mtn' }] } },
        coreModel: { getParameterIndex: () => 0 }
      },
      position: {},
      scale: {},
      rotation: 0,
      motion: (group, index) => calls.push(['motion', group, index]),
      expression: (name) => calls.push(['expression', name])
    }
    const controller = createMotionController({ getModel: () => model, ticker: fakeTicker() })
    const result = controller.play('shake')
    expect(result).toEqual({ ok: true, channel: 'native', key: 'shake' })
    expect(calls).toEqual([['motion', 'Tap', 0]])
  })

  it('Cubism 参数可用但素材没有 motion 时走 param 通道', () => {
    const written = []
    const model = {
      internalModel: {
        motionManager: { definitions: {} },
        coreModel: {
          getParameterIndex: (id) => (String(id).startsWith('ParamAngle') ? 1 : -1),
          setParameterValueById: (id, value) => written.push([id, value])
        }
      },
      position: {},
      scale: {},
      rotation: 0
    }
    const ticker = fakeTicker()
    let at = 0
    const controller = createMotionController({ getModel: () => model, ticker, now: () => at })
    const result = controller.play('shake')
    expect(result).toEqual({ ok: true, channel: 'param', key: 'shake' })
    at = 200
    ticker.tick()
    expect(written.some(([id]) => id === 'ParamAngleX')).toBe(true)
  })

  it('按心情播：bright 命中动作表里的候选', () => {
    const model = fakeDisplayObject()
    const controller = createMotionController({ getModel: () => model, ticker: fakeTicker() })
    const result = controller.playForMood('bright', { source: 'mood' })
    expect(result.ok).toBe(true)
    expect(MOOD_ACTIONS.bright).toContain(result.key)
  })

  it('没映射过的心情档位如实报失败', () => {
    const model = fakeDisplayObject()
    const controller = createMotionController({ getModel: () => model, ticker: fakeTicker() })
    expect(controller.playForMood('excited').ok).toBe(false)
  })

  it('能力清单只列真能播的动作，状态文案带通道信息', () => {
    const model = fakeDisplayObject()
    const controller = createMotionController({ getModel: () => model, ticker: fakeTicker() })
    const catalog = controller.catalog()
    expect(catalog.kind).toBe('sprite')
    expect(catalog.pixi).toBe(true)
    expect(catalog.nativeCount).toBe(0)
    expect(catalog.actions.length).toBeGreaterThan(0)
    expect(catalog.labels.bounce).toBe('弹一下')
    expect(controller.statusText()).toContain('pixi ✓')
    expect(controller.statusText()).toContain('自带 0')
  })

  it('事件回调把通道和来源报出来，失败也不影响播放', () => {
    const model = fakeDisplayObject()
    const events = []
    const controller = createMotionController({
      getModel: () => model,
      ticker: fakeTicker(),
      onEvent: (event) => events.push(event)
    })
    controller.play('tilt', { source: 'ai' })
    expect(events[0]).toMatchObject({ key: 'tilt', channel: 'pixi', source: 'ai' })
  })
})
