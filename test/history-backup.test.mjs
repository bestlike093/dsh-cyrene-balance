import test from 'node:test'
import assert from 'node:assert/strict'

import {
  extractBackupHistory,
  importHistoryFromBackup,
  importHistoryCandidates
} from '../lib/companion/memory/history-import.mjs'

function fakeFactStore(seed = []) {
  const facts = seed.map((item) => ({ archived: false, ...item }))
  const upserts = []
  return {
    upserts,
    snapshot: (scope) => ({
      facts: facts.filter((fact) => fact.scope === scope || scope === '')
    }),
    upsert: (list, at, scope) => {
      let added = 0
      let reinforced = 0
      for (const item of list) {
        const hit = facts.find((fact) => fact.text.replace(/\s+/g, '') === item.text.replace(/\s+/g, ''))
        if (hit !== undefined) reinforced += 1
        else {
          facts.push({ ...item, scope, archived: false })
          added += 1
        }
      }
      upserts.push({ list, at, scope })
      return { added, reinforced, superseded: 0 }
    }
  }
}

test('extractBackupHistory：从 bundle.data.history 取到消息', () => {
  const bundle = { format: 'cyrene-pet-backup', version: 1, data: { history: [{ role: 'user', content: '你好' }] } }
  assert.deepEqual(extractBackupHistory(bundle), [{ role: 'user', content: '你好' }])
})

test('extractBackupHistory：messages / chatHistory 键也认', () => {
  assert.equal(extractBackupHistory({ data: { messages: [{ role: 'user', text: 'a' }] } }).length, 1)
  assert.equal(extractBackupHistory({ data: { chatHistory: [{ role: 'user', text: 'b' }] } }).length, 1)
})

test('extractBackupHistory：sessions 数组合并各会话消息', () => {
  const bundle = {
    data: {
      sessions: [
        { id: 's1', messages: [{ role: 'user', text: '一' }, { role: 'assistant', text: '二' }] },
        { id: 's2', messages: [{ role: 'user', text: '三' }] },
        { id: 's3' }
      ]
    }
  }
  const result = extractBackupHistory(bundle)
  assert.equal(result.length, 3)
  assert.equal(result[2].text, '三')
})

test('extractBackupHistory：裸 data 对象（无 .data 包装）也认', () => {
  const result = extractBackupHistory({ history: [{ role: 'user', text: '直接放' }] })
  assert.equal(result.length, 1)
})

test('extractBackupHistory：没有历史返回空数组', () => {
  assert.deepEqual(extractBackupHistory({ data: { memory: { facts: [] } } }), [])
  assert.deepEqual(extractBackupHistory(null), [])
  assert.deepEqual(extractBackupHistory('not-an-object'), [])
})

test('importHistoryFromBackup：提取 + 候选 + 写库一步走', async () => {
  const store = fakeFactStore()
  const bundle = {
    data: {
      history: [
        { role: 'user', content: '我在做一个小工具', createdAt: 1700000000000 },
        { role: 'assistant', content: '听起来不错' },
        { role: 'user', content: '我喜欢喝咖啡', createdAt: 1700000001000 }
      ]
    }
  }
  const result = await importHistoryFromBackup({ bundle, factStore: store, at: () => 1700000002000 })
  assert.equal(result.ok, true)
  assert.equal(result.fromBackup, true)
  assert.equal(result.examined, 3)
  assert.equal(result.candidates, 2)
  assert.equal(result.added, 2)
  const snapshot = store.snapshot('desktop')
  assert.equal(snapshot.facts.length, 2)
  assert.ok(snapshot.facts.some((fact) => fact.text === '在做一个小工具'))
  assert.ok(snapshot.facts.some((fact) => fact.text === '喜欢喝咖啡'))
  // 导入的条目都是「被问到再说」，且带原话证据。
  for (const fact of snapshot.facts) {
    assert.equal(fact.mentionPolicy, 'on_request')
    assert.notEqual(fact.evidence, '')
  }
})

test('importHistoryFromBackup：备份里没有历史时不写库', async () => {
  const store = fakeFactStore()
  const result = await importHistoryFromBackup({ bundle: { data: { memory: {} } }, factStore: store })
  assert.equal(result.ok, true)
  assert.equal(result.fromBackup, true)
  assert.equal(result.examined, 0)
  assert.equal(store.upserts.length, 0)
})

test('importHistoryFromBackup：已记过的事实不重复写', async () => {
  const store = fakeFactStore([{ text: '喜欢喝咖啡', scope: 'desktop', kind: 'preference' }])
  const bundle = { data: { history: [{ role: 'user', content: '我喜欢喝咖啡' }] } }
  const result = await importHistoryFromBackup({ bundle, factStore: store, at: () => 1700000003000 })
  assert.equal(result.candidates, 1)
  assert.equal(result.added, 0)
  assert.equal(result.skipped, 1)
})

test('importHistoryCandidates：没有 store 时明确拒绝', async () => {
  const result = await importHistoryCandidates({ messages: [{ role: 'user', content: '我喜欢咖啡' }], factStore: null })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-store')
})
