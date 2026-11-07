// 设置页搜索的纯匹配逻辑。
// 只做「这段文字命不命中」的判断，不碰 DOM，便于单独测试；
// settings.js 负责把 DOM 里的标题、说明、条目、按钮喂进来。
;(function (root) {
  'use strict'

  // 空格、中英文逗号、顿号、分号都当分隔符：一次可以搜「记忆 搜索」。
  const SEPARATOR = /[\s,，、;；]+/

  /** 关键词拆成小写词元，去重；空输入返回空数组。 */
  function tokenize(raw) {
    if (typeof raw !== 'string') return []
    const seen = new Set()
    for (const part of raw.toLowerCase().split(SEPARATOR)) {
      const token = part.trim()
      if (token !== '') seen.add(token)
    }
    return [...seen]
  }

  /** 所有词元都出现在同一段文字里才算命中。 */
  function includesAll(text, tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return false
    const haystack = String(text ?? '').toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  }

  /**
   * 判断一个 section 是否命中。
   *
   * section: { title, note, items: string[], actions: string[] }
   * 返回:
   *   hit      —— 这一段要不要留下
   *   scope    —— section=整段保留；items=只留命中的条目；none=不命中
   *   itemHits —— 与 items 等长，决定每个条目是否显示
   *
   * 关键词落在标题 / 说明 / 按钮上时保留整段；
   * 只落在某些条目上时只留那些条目；
   * 关键词分散在同一段的标题和不同条目里时也保留整段，避免「明明有却搜不到」。
   */
  function matchSection(section, tokens) {
    const items = Array.isArray(section?.items) ? section.items.map((item) => String(item ?? '')) : []
    const actions = Array.isArray(section?.actions)
      ? section.actions.map((action) => String(action ?? ''))
      : []
    const hidden = items.map(() => false)

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return { hit: false, scope: 'none', itemHits: hidden }
    }

    const title = String(section?.title ?? '')
    const note = String(section?.note ?? '')
    const chrome = [title, note, ...actions].join(' ')
    if (includesAll(chrome, tokens)) {
      return { hit: true, scope: 'section', itemHits: items.map(() => true) }
    }

    const itemHits = items.map((item) => includesAll(item, tokens))
    if (itemHits.some(Boolean)) {
      return { hit: true, scope: 'items', itemHits }
    }

    const whole = [chrome, ...items].join(' ')
    if (includesAll(whole, tokens)) {
      return { hit: true, scope: 'section', itemHits: items.map(() => true) }
    }
    return { hit: false, scope: 'none', itemHits: hidden }
  }

  /** 面板名也参与搜索：搜「记忆」应该能找到整个记忆页。 */
  function matchPanelName(name, tokens) {
    return includesAll(name, tokens)
  }

  root.SettingsSearch = { tokenize, includesAll, matchSection, matchPanelName }
})(typeof window !== 'undefined' ? window : globalThis)
