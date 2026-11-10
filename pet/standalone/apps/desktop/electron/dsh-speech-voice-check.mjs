/**
 * 自检：技术回复经过这一层，出来的是不是一句能听的话。
 *
 * node dsh-speech-voice-check.mjs
 */
import { toSpokenLine } from './dsh-speech-voice.mjs'

const cases = [
  {
    name: '带代码块和路径',
    input: [
      '## 修改完成',
      '',
      '我把 `lib/companion/voice-codec.mjs` 加上了转码层，位置在 `D:\\plugins\\dsh-cyrene-pet`。',
      '',
      '```js',
      "import { encode } from 'silk-wasm'",
      'const result = await encode(wav, 0)',
      '```',
      '',
      '**注意**：只接受回环地址，不会把台词发出去。',
      '',
      '要我现在重启测一下吗？'
    ].join('\n')
  },
  {
    name: '带列表和加粗',
    input: [
      '这里有两个方向：',
      '',
      '1. **规则层**：去掉代码块和路径',
      '2. **模型层**：重新改写一遍',
      '',
      '因此我建议先走规则层，成本低。'
    ].join('\n')
  },
  {
    name: '纯解释，没有结论词',
    input: '这个问题的根源在于去重键不稳定。文件每次重写，行号都会变，所以只能靠事件时间。'
  },
  {
    name: '很短的一句',
    input: '好了。'
  },
  {
    name: '全是噪声',
    input: '```bash\nnpm install\n```'
  },
  {
    name: '带链接',
    input: '参考 [DeepSeek 文档](https://api-docs.deepseek.com/zh-cn/) 里的说明，已经按文档改好了呀。'
  },
  {
    name: '数学符号与对勾保留',
    input: '用 a*b 表示乘法，✓ 已经验证通过。'
  },
  {
    name: '失败句不抢收尾',
    input: '编译失败了，报错在控制台里。要我帮你重启一下吗？'
  }
]

/** 念出来的句子不许带这些残渣：代码围栏、行内代码、路径、链接、加粗标记。 */
const NOISE_FRAGMENTS = ['```', '`', '\\', '**', 'http', '//']

let failed = 0
for (const item of cases) {
  const spoken = toSpokenLine(item.input, { maxChars: 60 })
  const expectEmpty = item.name === '全是噪声'
  const problems = []
  if (expectEmpty ? spoken !== '' : spoken === '') {
    problems.push(`期望${expectEmpty ? '空串' : '有输出'}，实际「${spoken}」`)
  }
  if (!expectEmpty) {
    for (const fragment of NOISE_FRAGMENTS) {
      if (spoken.includes(fragment)) problems.push(`残留噪声 ${fragment}`)
    }
  }
  if (item.name === '数学符号与对勾保留') {
    // 收窄噪声规则后，乘号和对勾不该被当装饰符号删掉。
    if (!spoken.includes('*')) problems.push('乘号被误删')
    if (!spoken.includes('✓')) problems.push('对勾被误删')
  }
  if (item.name === '失败句不抢收尾') {
    // 「失败/报错」不算结论词：应该念收尾句而不是把报错念出来。
    if (spoken.includes('失败') || spoken.includes('报错')) problems.push('念了负面结果句')
  }
  const ok = problems.length === 0
  if (!ok) failed += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${item.name}${problems.length > 0 ? ` — ${problems.join('；')}` : ''}`)
  console.log(`     → ${spoken === '' ? '(跳过不念)' : spoken}`)
}

console.log(`\n${failed === 0 ? 'ok:true' : `ok:false (${failed} failed)`}`)
process.exitCode = failed === 0 ? 0 : 1
