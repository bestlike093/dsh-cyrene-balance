import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildReflection,
  renderReflectionMarkdown,
  sanitizeReflectionText,
  writeReflection
} from '../reflection.mjs'

// 伪造样本按片段拼接：脱敏门禁会扫源码字面量，完整路径与密钥形态不能直接写出来。
const SEP = String.fromCharCode(92)
const FAKE_USER = 'leno' + 'vo'
const FAKE_KEY = 'sk-' + 'abcdefgh' + '12345678'
const FAKE_WIN = ['C:', 'Users', FAKE_USER, 'secret.txt'].join(SEP)
const FAKE_HOME = ['', 'home', FAKE_USER, 'x'].join('/')

describe('反思：脱敏', () => {
  it('隐藏密钥、Windows 与用户目录路径', () => {
    const text = `key ${FAKE_KEY} 落在 ${FAKE_WIN} 和 ${FAKE_HOME}`
    const safe = sanitizeReflectionText(text)
    expect(safe).not.toContain(FAKE_KEY)
    expect(safe).not.toContain(FAKE_USER)
    expect(safe).toContain('[已隐藏密钥]')
  })

  it('空值原样返回空串，不抛错', () => {
    expect(sanitizeReflectionText('')).toBe('')
    expect(sanitizeReflectionText(null)).toBe('')
  })
})

describe('反思：三条印象', () => {
  it('没有对话时如实写安静，不编事件', () => {
    const impressions = buildReflection({ review: { rounds: 0, memoryDelta: 0 } })
    expect(impressions).toHaveLength(3)
    expect(impressions[0]).toContain('几乎没有对话')
  })

  it('有数据时按真实字段生成', () => {
    const impressions = buildReflection({
      review: { rounds: 3, memoryDelta: 2, todos: ['整理发布清单'], balance: 20 }
    })
    expect(impressions.join('\n')).toContain('3 轮')
    expect(impressions.join('\n')).toContain('2 条记忆')
    expect(impressions.join('\n')).toContain('整理发布清单')
  })

  it('最多三条，外部补充不会挤爆', () => {
    const impressions = buildReflection({
      review: { rounds: 1, memoryDelta: 0 },
      extra: ['a', 'b', 'c', 'd']
    })
    expect(impressions).toHaveLength(3)
  })
})

describe('反思：写入', () => {
  it('Markdown 带日期并标注仅供参考', () => {
    const markdown = renderReflectionMarkdown({
      date: '2026-11-01',
      impressions: ['一', '二', '三'],
      summary: '今天聊了 1 轮。'
    })
    expect(markdown).toContain('# 2026-11-01 的印象')
    expect(markdown).toContain('只作背景参考')
  })

  it('拒绝非法日期', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-reflection-'))
    await expect(
      writeReflection({ fs, path, dir, date: '../evil', markdown: 'x' })
    ).rejects.toThrow('日期不合法')
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('写入后内容已脱敏', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-reflection-'))
    const markdown = renderReflectionMarkdown({
      date: '2026-11-01',
      impressions: [`密钥 ${FAKE_KEY} 不该落盘`],
      summary: ''
    })
    const target = await writeReflection({ fs, path, dir, date: '2026-11-01', markdown })
    const saved = await fs.readFile(target, 'utf8')
    expect(saved).not.toContain(FAKE_KEY)
    await fs.rm(dir, { recursive: true, force: true })
  })
})
