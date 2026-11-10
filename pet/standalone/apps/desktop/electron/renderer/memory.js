const bridge = window.pet ?? {}

function el(id) {
  return document.getElementById(id)
}

function codeOf(id) {
  const text = String(id ?? '')
  if (text === '') return '未知'
  return text.length <= 10 ? text : `…${text.slice(-8)}`
}

function timeText(at) {
  const value = Number(at)
  if (!Number.isFinite(value) || value <= 0) return '还没动过'
  const diff = Date.now() - value
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`
  return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`
}

function peerOf(peers, key) {
  return peers.find((item) => item.key === key) ?? null
}

function tag(text, plain = false) {
  const node = document.createElement('span')
  node.className = plain ? 'm-tag is-plain' : 'm-tag'
  node.textContent = text
  return node
}

function item(title, count, lastAt, peer, extraTags = []) {
  const box = document.createElement('div')
  box.className = 'm-item'

  const head = document.createElement('div')
  head.className = 'm-item-head'

  const name = document.createElement('span')
  name.className = 'm-name'
  name.textContent = title
  head.appendChild(name)

  const meta = document.createElement('span')
  meta.className = 'm-meta'
  meta.textContent = timeText(lastAt)
  head.appendChild(meta)

  box.appendChild(head)

  const tags = document.createElement('div')
  tags.className = 'm-tags'
  tags.appendChild(tag(`${count} 条`, true))
  for (const text of extraTags) tags.appendChild(tag(text, true))
  if (peer !== null) {
    tags.appendChild(tag(`关系 ${memBandOf(peer.affinity, MEM_AFFINITY_BANDS)}`))
    if (peer.familiarity > 0) {
      tags.appendChild(tag(`熟悉度 ${memBandOf(peer.familiarity, MEM_FAMILIAR_BANDS)}`))
    }
    if (peer.irritation > 0) {
      tags.appendChild(tag(`情绪 ${memBandOf(peer.irritation, MEM_FRICTION_BANDS)}`))
    }
  }
  box.appendChild(tags)

  return box
}

/* 与 insight.js 同一组档位：这一页也别说裸数值，免得两处口径不一样。
   边界来自 lib/companion/snapshot.mjs 的基准档（忍受度 55）。 */
const MEM_AFFINITY_BANDS = [
  { max: 19, label: '还陌生' },
  { max: 49, label: '有点熟' },
  { max: 79, label: '亲近' },
  { max: Infinity, label: '很亲近' }
]
const MEM_FAMILIAR_BANDS = [
  { max: 0, label: '刚认识' },
  { max: 29, label: '还生疏' },
  { max: 69, label: '渐渐熟了' },
  { max: Infinity, label: '已经很熟' }
]
const MEM_FRICTION_BANDS = [
  { max: 59, label: '平静' },
  { max: 84, label: '有点烦' },
  { max: Infinity, label: '很烦' }
]

function memBandOf(value, bands) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  for (const band of bands) if (n <= band.max) return band.label
  return bands[bands.length - 1].label
}

function empty(text) {
  const node = document.createElement('div')
  node.className = 'm-empty'
  node.textContent = text
  return node
}

function groupCard(entry, peers) {
  const box = document.createElement('div')
  box.className = 'm-item'

  const head = document.createElement('div')
  head.className = 'm-item-head'

  const name = document.createElement('span')
  name.className = 'm-name'
  name.textContent = `群 ${codeOf(entry.scopeId)}`
  head.appendChild(name)

  const meta = document.createElement('span')
  meta.className = 'm-meta'
  meta.textContent = timeText(entry.lastAt)
  head.appendChild(meta)

  box.appendChild(head)

  const tags = document.createElement('div')
  tags.className = 'm-tags'
  tags.appendChild(tag(`${entry.count} 条`, true))
  tags.appendChild(tag(`${Array.isArray(entry.peers) ? entry.peers.length : 0} 个发言人`, true))
  box.appendChild(tags)

  const list = Array.isArray(entry.peers) ? entry.peers : []
  if (list.length === 0) {
    box.appendChild(empty('这个群还没有按人分开的记录。'))
    return box
  }

  const sub = document.createElement('div')
  sub.className = 'm-sub'
  for (const person of list) {
    const row = document.createElement('div')
    row.className = 'm-sub-row'

    const left = document.createElement('span')
    left.className = 'm-sub-name'
    const peer = peerOf(peers, `qq:group:${entry.scopeId}#${person.peer}`)
    const bits = [`${codeOf(person.peer)} · ${person.count} 条`]
    if (peer !== null) bits.push(`关系 ${memBandOf(peer.affinity, MEM_AFFINITY_BANDS)}`)
    if (peer !== null && peer.irritation > 0) {
      bits.push(`情绪 ${memBandOf(peer.irritation, MEM_FRICTION_BANDS)}`)
    }
    left.textContent = bits.join(' · ')
    row.appendChild(left)

    const right = document.createElement('span')
    right.className = 'm-meta'
    right.textContent = timeText(person.lastAt)
    row.appendChild(right)

    sub.appendChild(row)
  }
  box.appendChild(sub)

  return box
}

function render(data) {
  const scopes = data.scopes ?? {}
  const peers = Array.isArray(data.peers) ? data.peers : []
  const owners = Array.isArray(scopes.owners) ? scopes.owners : []
  const privates = Array.isArray(scopes.privates) ? scopes.privates : []
  const groups = Array.isArray(scopes.groups) ? scopes.groups : []

  el('m-owner-count').textContent = String(owners.length)
  el('m-private-count').textContent = String(privates.length)
  el('m-group-count').textContent = String(groups.length)

  const ownerList = el('m-owner-list')
  ownerList.replaceChildren()
  if (owners.length === 0) {
    ownerList.appendChild(empty('还没有主人这条线的记录。'))
  } else {
    for (const entry of owners) {
      const peer =
        peerOf(peers, `qq:private:${entry.scopeId}`) ?? peerOf(peers, 'desktop')
      ownerList.appendChild(item(`主人 ${codeOf(entry.scopeId)}`, entry.count, entry.lastAt, peer))
    }
  }

  const privateList = el('m-private-list')
  privateList.replaceChildren()
  if (privates.length === 0) {
    privateList.appendChild(empty('还没有别人私聊过她。'))
  } else {
    for (const entry of privates) {
      privateList.appendChild(
        item(
          `私聊 ${codeOf(entry.scopeId)}`,
          entry.count,
          entry.lastAt,
          peerOf(peers, `qq:private:${entry.scopeId}`),
        ),
      )
    }
  }

  const groupList = el('m-group-list')
  groupList.replaceChildren()
  if (groups.length === 0) {
    groupList.appendChild(empty('还没有群聊记录。群里只有被 @ 的消息会到这边。'))
  } else {
    for (const entry of groups) groupList.appendChild(groupCard(entry, peers))
  }

  const foot = el('m-foot')
  foot.classList.remove('is-bad')
  const parts = [`快照时间：${timeText(data.at)}`]
  parts.push(`插件侧共 ${Number(data.itemCount) || 0} 条`)
  const vaultError = typeof data.vaultError === 'string' ? data.vaultError : ''
  if (vaultError !== '') {
    parts.push(`仓库打不开：${vaultError}`)
    foot.classList.add('is-bad')
  }
  foot.textContent = parts.join(' · ')
}

function fail(reason, file) {
  const foot = el('m-foot')
  foot.classList.add('is-bad')
  if (reason === 'not-ready') {
    foot.textContent = '插件还没写出快照。等她在 DSH 里说过一句话，再点「再看一眼」。'
  } else {
    foot.textContent = `读取失败：${reason}${typeof file === 'string' ? `（${file}）` : ''}`
  }
}

async function refresh() {
  if (typeof bridge.getMemoryConsole !== 'function') {
    fail('bridge-missing')
    return
  }
  const data = await bridge.getMemoryConsole()
  if (data?.ok === true) render(data)
  else fail(String(data?.reason ?? 'unknown'), data?.file)
}

el('m-refresh').addEventListener('click', () => {
  void refresh()
})

el('m-close').addEventListener('click', () => {
  if (typeof bridge.closeMemoryConsole === 'function') void bridge.closeMemoryConsole()
})

void refresh()
