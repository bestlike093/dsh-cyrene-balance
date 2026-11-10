/**
 * 调试面板的视图模型。
 *
 * 纯投影：只把运行时已经算好的值摆到面板上。
 * 函数内不调 deriveTraits / nostalgiaDetail / 词表 / 公式——
 * 否则词表改了而 traits 没重推，面板显示的会和 recallFrom 用的变成两份值。
 * 面板要的是「此刻生效值」，不是理论值。
 *
 * 两条边界：
 *   1. 不读时钟。now 只从参数来；命令行传固定值即可复现。
 *   2. origin 与 stale 分开放。origin 说「这个值从哪来」，stale 只当调试布尔；
 *      autoLocate:false 时按「关了就当没有」忽略残留，显示「未设置」。
 *      显示优先级写死：外壳未接 > 残留值 > 开关。
 *
 * 字段形状对齐 @pet/ui 的 SettingsFieldV1（kind / readonlyReason 原样使用），
 * 等那份源码回来、构建重生成 dist 时零改动被吃掉。
 * 注意：对齐的是类型契约，不等于 ui 已经会渲染——dist 没有 src，那一侧仍是「外壳未接」。
 */

import { TRAITS_VERSION, WORDSET_ID, WORDSET_SIZE } from '../persona/traits.mjs'

/* 2：新增 agenda.source；persona.digest 增外壳归属，形状变了。 */
export const PANEL_VIEW_VERSION = 2

/* city 留空时的回落城市。只用于显示，不写回设置。 */
export const DEFAULT_CITY = '北京'

/* 来源标签：三档 + 两个更细的来源。 */
export const ORIGIN = Object.freeze({
  MANUAL: '你填的',
  DEFAULT_CITY: '默认北京',
  UNSET: '未设置',
  AUTO: '自动定位',
  SHELL_PENDING: '外壳未接',
})

/*
 * 节目单来源：两套外壳各自的事实。
 * 插件版走 schedule.mjs 的七条固定时刻，桌面版走 daily-plan 问模型生成；
 * 两边都叫 agenda，语义不同，不能合成一格。
 */
export const AGENDA_SOURCE = Object.freeze({
  MODEL: '模型生成',
  FIXED: '硬编码 7 时刻',
  UNSET: '外壳未接',
})

function textOf(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function numberOf(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function formatSigned(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${num > 0 ? '+' : ''}${num.toFixed(2)}`
}

function truncate(value, max) {
  const text = textOf(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/* 手填优先；空串回落默认城市，这一格永远不会显示「未设置」。 */
function cityField(id, label, raw) {
  const value = textOf(raw).trim()
  if (value !== '') {
    return { id, group: 'presence', label, kind: 'text', value, origin: ORIGIN.MANUAL }
  }
  return { id, group: 'presence', label, kind: 'text', value: DEFAULT_CITY, origin: ORIGIN.DEFAULT_CITY }
}

/**
 * @param {object} input
 * @param {object} input.settings  归一化后的设置（state.settings）
 * @param {object} input.derived   运行时那份：{ companionTraits, personaDigest, baseText }
 * @param {object} input.capabilities 外壳能力：{ autoLocateProbe }
 * @param {number} input.now       只用于标注时间，不参与任何计算
 */
export function buildPanelView({ settings = {}, derived = {}, capabilities = {}, now = 0 } = {}) {
  const presence = settings?.presence ?? {}
  const traits = derived?.companionTraits ?? {}
  const detail = traits.recallDetail ?? null
  /*
   * 0 和 undefined 同一档：normalize 缺版本会补 0，真机保存一次后就再也见不到 undefined。
   * 判据用「版本号大于 0」，不用字段存不存在——否则 0 会落进「有版本、明细 null」，
   * 旧版那条提示就悄悄丢了。
   */
  const version = numberOf(traits.traitsVersion, 0)
  const hasVersion = version > 0
  const versionChanged = hasVersion && version !== TRAITS_VERSION
  const wordsId = textOf(traits.wordsId)
  /* 指纹对不上（含旧版没写）就是旧词表推的：值还能用，但得让人看见它会失效。 */
  const wordsChanged = hasVersion && wordsId !== WORDSET_ID
  const storeStale = versionChanged || wordsChanged
  const hasDetail = detail !== null && typeof detail === 'object'
  const hasBias = hasDetail && Number.isFinite(Number(traits.recallBias))
  /*
   * 没推演过有两种：旧版 state 压根没有版本号，或新版写了版本但明细还是 null。
   * 分开说，别让「中性」冒充「没跑过」。
   */
  const notDerived = hasVersion ? '未推演' : '未推演（旧版 state）'

  const biasField = {
    id: 'recall.bias',
    group: 'recall',
    label: '念旧倾向',
    kind: 'readonly',
    value: hasBias ? formatSigned(traits.recallBias) : notDerived,
    stale: storeStale,
    hint: hasBias
      ? [
          `半衰期 ${numberOf(detail.halfLifeDays).toFixed(2)} 天`,
          `基于 v${version}-${wordsId || '?'} 词表`,
          storeStale ? `当前 v${TRAITS_VERSION}-${WORDSET_ID}，建议重推` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : hasVersion
        ? '版本标记在，明细还是空的；等下一次挂人格重推。'
        : '没有可用版本号（旧版 state 或 normalize 补的 0），无法判断推演过没有。',
  }

  const hits = Array.isArray(detail?.hits) ? detail.hits : []
  const hitsField = {
    id: 'recall.hits',
    group: 'recall',
    label: '命中词',
    kind: 'readonly',
    value: !hasDetail
      ? '—'
      : hits.length === 0
        ? '无命中'
        : hits.map((hit) => `${hit.side === 'neg' ? '−' : '+'}${hit.word}×${numberOf(hit.count)}`).join('、'),
    hint: '正负分开算，重复命中按 1/3 递减。',
  }

  /*
   * 未命中词按 side 分开陈列。
   * 反向词必须带 side：照着清单写「不往前走」会被剥掉否定前缀，极性和预期相反。
   */
  const zeroHitWords = Array.isArray(detail?.zeroHitWords) ? detail.zeroHitWords : []
  const zeroPos = zeroHitWords.filter((entry) => entry?.side !== 'neg').map((entry) => entry.word)
  const zeroNeg = zeroHitWords.filter((entry) => entry?.side === 'neg').map((entry) => entry.word)
  const zeroValue = !hasDetail
    ? '—'
    : zeroHitWords.length === 0
      ? '整表都命中'
      : [
          zeroPos.length > 0 ? `正向 ${zeroPos.join('、')}` : '',
          zeroNeg.length > 0 ? `反向 ${zeroNeg.join('、')}` : '',
        ].filter(Boolean).join('  /  ')
  const zeroField = {
    id: 'recall.zero',
    group: 'recall',
    label: hasDetail ? `未命中 ${zeroHitWords.length} 词 / 共 ${WORDSET_SIZE} 词` : '未命中词',
    kind: 'readonly',
    value: zeroValue,
    hint: hasDetail
      ? '正向词写进人设会加念旧；反向词写肯定式即可，别再叠否定——前缀会被剥掉，极性会反一次。'
      : '还没有可陈列的词表结果。',
  }

  /* bubbleTone 显示 normalize 后的生效布尔，不显示 schema 默认值。 */
  const toneField = {
    id: 'talk.bubbleTone',
    group: 'talk',
    label: '气泡句末语气',
    kind: 'toggle',
    value: settings?.companion?.bubbleTone !== false ? '开' : '关',
    hint: '关掉后气泡原文照出，整条后处理不生效。',
  }

  const autoLocateOn = presence.autoLocate === true
  const probeWired = capabilities?.autoLocateProbe === true
  const residue = textOf(presence.autoLocatedCity).trim()
  /*
   * stale = 有残留、但没被当有效值用。
   * 外壳未接时残留同样没被用上，所以第一态也该是 true；
   * 之前只在「已接 + 开关关」时才算，会让第一态看起来像用上了残留。
   */
  const stale = residue !== '' && !(probeWired && autoLocateOn)
  let autoValue = ORIGIN.UNSET
  let autoOrigin = ORIGIN.UNSET
  let autoDegraded = false
  if (!probeWired) {
    autoValue = residue || '—'
    autoOrigin = ORIGIN.SHELL_PENDING
    autoDegraded = true
  } else if (autoLocateOn) {
    autoValue = residue || ORIGIN.UNSET
    autoOrigin = residue ? ORIGIN.AUTO : ORIGIN.UNSET
  }
  const autoField = {
    id: 'presence.autoLocatedCity',
    group: 'presence',
    label: '自动定位结果',
    kind: 'readonly',
    value: autoValue,
    origin: autoOrigin,
    stale,
    ...(autoDegraded ? { readonly: true, readonlyReason: ORIGIN.SHELL_PENDING } : {}),
  }

  /*
   * 节目单来源：外壳自报的事实，不在面板里猜。
   * 两套外壳的供给本来就不同，这一格让分叉可观测，不负责把两边拉齐。
   */
  const agendaSource = textOf(capabilities?.agendaSource)
  const agendaField = {
    id: 'agenda.source',
    group: 'persona',
    label: '节目单来源',
    kind: 'readonly',
    value:
      agendaSource === 'model'
        ? AGENDA_SOURCE.MODEL
        : agendaSource === 'fixed'
          ? AGENDA_SOURCE.FIXED
          : AGENDA_SOURCE.UNSET,
    hint:
      agendaSource === 'model'
        ? '桌面版：daily-plan 问模型生成 24 小时段表，经 setAgenda 交给 pickCandidate。'
        : agendaSource === 'fixed'
          ? '插件版：schedule.mjs 的七条固定时刻直接喂 pickCue；daily-plan 不参与。'
          : '外壳没有声明节目单来源，这一格不推断。',
  }

  /*
   * 人格摘要：值和 stale 都只从 derived.personaDigest 读——调用点不许临时算，
   * 否则两个调用点会给出不同结论，纯投影就破了。
   * 外壳没接生成器时标「不适用」，别让「未生成」看起来像只差一次调用。
   */
  const digest = derived?.personaDigest ?? null
  const digestWired = capabilities?.personaDigest === true
  const digestField = {
    id: 'persona.digest',
    group: 'persona',
    label: '人格摘要',
    kind: 'readonly',
    value: digest?.text ? truncate(digest.text, 48) : digestWired ? '未生成' : '外壳未接 / 不适用',
    stale: digest?.stale === true,
    hint: digestWired
      ? '摘要和人格文本对不上时标 stale；面板只显示，不重生成。'
      : '摘要只挂桌面版 daily-plan 的 prompt；插件版没有这个挂载点，不生成。',
  }

  const baseText = textOf(derived?.baseText).trim()
  const baseTextField = {
    id: 'bubble.baseText',
    group: 'bubble',
    label: '最近一次气泡原文',
    kind: 'text',
    value: baseText || '—',
    hint: '加工前的原文；句末温度只改气泡那一份，不回写。',
  }

  return {
    version: PANEL_VIEW_VERSION,
    /* now 只当标注，不参与任何判定。 */
    at: numberOf(now, 0),
    groups: [
      { id: 'recall', label: '记忆倾向', fields: [biasField, hitsField, zeroField] },
      { id: 'talk', label: '说话', fields: [toneField] },
      {
        id: 'presence',
        label: '位置',
        fields: [
          cityField('presence.city', '她所在城市', presence.city),
          cityField('presence.ownerCity', '你所在城市', presence.ownerCity),
          {
            id: 'presence.autoLocate',
            group: 'presence',
            label: '自动定位开关',
            kind: 'toggle',
            value: autoLocateOn ? '开' : '关',
            hint: '关掉时忽略残留值，不把上次的结果当成当前。',
          },
          autoField,
        ],
      },
      { id: 'persona', label: '人格与节目单', fields: [agendaField, digestField] },
      { id: 'bubble', label: '最近气泡', fields: [baseTextField] },
    ],
  }
}
