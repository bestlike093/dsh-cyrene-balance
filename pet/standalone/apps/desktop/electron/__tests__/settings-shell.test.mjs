import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../renderer/settings.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../renderer/settings.html', import.meta.url), 'utf8')

/** 取出某个选择器的第一条规则体；找不到就返回空串。 */
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  return match === null ? '' : match[1]
}

describe('设置窗外壳：可点击区域', () => {
  it('左侧栏是自绘标题栏的拖动区', () => {
    expect(ruleBody('.s-nav')).toContain('-webkit-app-region: drag')
  })

  it('搜索框不会被拖动区吃掉点击', () => {
    expect(ruleBody('.s-search')).toContain('-webkit-app-region: no-drag')
  })
})

describe('设置窗外壳：脚本顺序', () => {
  it('搜索纯逻辑先于 settings.js 加载', () => {
    const searchIndex = html.indexOf('./settings-search.js')
    const settingsIndex = html.indexOf('./settings.js')
    expect(searchIndex).toBeGreaterThan(-1)
    expect(settingsIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeLessThan(settingsIndex)
  })
})
