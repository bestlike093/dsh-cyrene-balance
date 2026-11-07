import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererDir = fileURLToPath(new URL('../renderer/', import.meta.url))
const html = readFileSync(`${rendererDir}settings.html`, 'utf8')
const js = readFileSync(`${rendererDir}settings.js`, 'utf8')

/** 收集 HTML 里的 id，供「脚本引用的控件是否存在」检查。 */
function htmlIds() {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]))
}

/** 收集脚本里 $('x') / getElementById('x') 的静态 id。 */
function referencedIds() {
  const ids = new Set()
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) ids.add(match[1])
  for (const match of js.matchAll(/getElementById\('([^']+)'\)/g)) ids.add(match[1])
  return ids
}

describe('设置页控件完整性', () => {
  it('脚本引用的每个控件都能在页面里找到，避免读设置时中途抛错', () => {
    const existing = htmlIds()
    const missing = [...referencedIds()].filter((id) => !existing.has(id)).sort()
    expect(missing).toEqual([])
  })

  it('导航登记的每个面板都真的存在', () => {
    const declared = new Set()
    for (const match of js.matchAll(/panels:\s*\[([^\]]+)\]/g)) {
      for (const name of match[1].matchAll(/'([^']+)'/g)) declared.add(name[1])
    }
    const panels = new Set(
      [...html.matchAll(/class="panel[^"]*"\s+data-panel="([^"]+)"/g)].map((match) => match[1])
    )
    expect([...declared].filter((name) => !panels.has(name))).toEqual([])
    expect([...panels].filter((name) => !declared.has(name))).toEqual([])
  })

  it('已经确认没有运行时的陪伴任务控件不再出现在页面上', () => {
    for (const id of [
      'care-case-review-enabled',
      'care-case-review-at',
      'care-questionnaire-enabled',
      'care-maslow-enabled'
    ]) {
      expect(html).not.toContain(id)
      expect(js).not.toContain(id)
    }
  })

  it('情绪与额度的控件都在页面上，并且都接到了保存逻辑', () => {
    for (const id of [
      'emotion-afterglow-enabled',
      'emotion-afterglow-half-life',
      'emotion-expression-group',
      'emotion-needs-enabled',
      'care-budget-enabled',
      'care-budget-limit'
    ]) {
      expect(html).toContain(`id="${id}"`)
      expect(js).toContain(id)
    }
  })

  it('搜索匹配模块先于设置脚本加载', () => {
    const searchAt = html.indexOf('./settings-search.js')
    const settingsAt = html.indexOf('./settings.js')
    expect(searchAt).toBeGreaterThan(-1)
    expect(settingsAt).toBeGreaterThan(-1)
    expect(searchAt).toBeLessThan(settingsAt)
  })

  it('搜索框挂了回车与上下键跳转，而不是只能输入', () => {
    expect(js).toContain("$('settings-search').addEventListener('keydown'")
    expect(js).toContain('stepSearchHit(')
  })
})

describe('重置入口', () => {
  const mainSource = readFileSync(fileURLToPath(new URL('../main.mjs', import.meta.url)), 'utf8')
  const ipcSource = readFileSync(fileURLToPath(new URL('../../src/ipc.ts', import.meta.url)), 'utf8')

  it('从页脚搬到系统页的三处入口都在，旧按钮不再残留', () => {
    for (const id of ['reset-all-settings', 'factory-reset']) {
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).not.toContain('defaults-reset-all')
    expect(js).not.toContain('defaults-reset-all')
  })

  it('三处危险动作都要过输入确认词，不能一点就清', () => {
    expect(js).toContain("confirmWord: t('data.resetAllWord')")
    expect(js).toContain("confirmWord: t('data.factoryWord')")
    expect(js).toContain("confirmWord: t('moduleClear.confirmWord')")
    expect(js).toContain('function injectModuleResets')
    expect(js).toContain('function resetModule')
    expect(js).toContain('function factoryReset')
  })

  it('清除本模块设置覆盖除概览外的六个分组，每个面板都真实存在', () => {
    const pairs = [...js.matchAll(/group: '(\w+)',\s*panel: '(\w+)'/g)].map((match) => ({
      group: match[1],
      panel: match[2]
    }))
    expect(pairs.map((pair) => pair.group)).toEqual([
      'self',
      'talk',
      'company',
      'memory',
      'ability',
      'system'
    ])

    const panels = new Set(
      [...html.matchAll(/class="panel[^"]*"\s+data-panel="([^"]+)"/g)].map((match) => match[1])
    )
    for (const pair of pairs) expect(panels.has(pair.panel)).toBe(true)
  })

  it('恢复出厂通道已进白名单，主进程与 preload 都接上了', () => {
    expect(ipcSource).toContain("'pet:factory:reset'")
    expect(mainSource).toContain("registerChannel('pet:factory:reset'")
    const preload = readFileSync(fileURLToPath(new URL('../preload.cjs', import.meta.url)), 'utf8')
    expect(preload).toContain("ipcRenderer.invoke('pet:factory:reset')")
  })
})

describe('界面文案', () => {
  const i18n = readFileSync(`${rendererDir}i18n.js`, 'utf8')
  const zh = i18n.slice(i18n.indexOf('const ZH = {'), i18n.indexOf('const EN = {'))
  const en = i18n.slice(i18n.indexOf('const EN = {'))

  /** 同一个字典里重复写同一个 key，后一条会静默覆盖前一条。 */
  function duplicateKeys(block) {
    const seen = new Set()
    const duplicated = new Set()
    for (const match of block.matchAll(/^\s+'([^']+)':/gm)) {
      if (seen.has(match[1])) duplicated.add(match[1])
      seen.add(match[1])
    }
    return [...duplicated].sort()
  }

  it('中文与英文文案都没有重复 key', () => {
    expect(duplicateKeys(zh)).toEqual([])
    expect(duplicateKeys(en)).toEqual([])
  })

  it('记忆页不再出现实现词', () => {
    const memoryLines = zh
      .split(/\r?\n/)
      .filter((line) => /^\s+'(?:hint\.)?memory\./.test(line))
      .join('\n')
    for (const word of ['加密仓库', '权重', '淘汰', '落盘', '脱敏', '压缩成条目']) {
      expect(memoryLines).not.toContain(word)
    }
  })
})

describe('已清理的假开关', () => {
  it('「摘要间隔」不再有控件、回显与写入', () => {
    expect(html).not.toContain('memory-summarize-every')
    expect(js).not.toContain('summarizeEvery')
  })
})
