/* 桌面弹幕层：一条一条从右往左飘过去。
   只接收主进程推来的 { id, text, tone }，不读文件、不联网、不留记录。
   字号 / 不透明度 / 时长 / 轨道数由主进程放在 URL 参数里，这里只读不改。 */

const stage = document.getElementById('stage')

function readNumber(name, min, max, fallback) {
  const raw = new URLSearchParams(window.location.search).get(name)
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

const LANES = Math.round(readNumber('tracks', 3, 12, 7))
const FONT_SIZE = Math.round(readNumber('font', 14, 40, 22))
const OPACITY = readNumber('opacity', 0.3, 1, 0.95)
/* 固定秒数时不再按距离算；给 0 就回到自适应。 */
const FIXED_SECONDS = Math.round(readNumber('seconds', 0, 30, 0))
const SPEED = 190 // px/s，大概是一眼看清又不拖沓的速度

/* 每条轨道记一个「这一条什么时候能再进」的时间点，
   长句占轨久一点，短句不会把长句撞上。 */
const laneFreeAt = new Array(LANES).fill(0)
let laneCursor = 0

function pickLane(duration) {
  const now = performance.now()
  let chosen = -1
  let earliest = Infinity
  for (let i = 0; i < LANES; i += 1) {
    const index = (laneCursor + i) % LANES
    if (laneFreeAt[index] <= now) {
      chosen = index
      break
    }
    if (laneFreeAt[index] < earliest) {
      earliest = laneFreeAt[index]
      chosen = index
    }
  }
  laneCursor = (chosen + 1) % LANES
  laneFreeAt[chosen] = now + duration * 0.6
  return chosen
}

function show(item) {
  const text = typeof item?.text === 'string' ? item.text.trim() : ''
  if (text === '' || stage === null) return

  const node = document.createElement('div')
  node.className = item?.tone === 'user' ? 'dm user' : 'dm pet'
  node.textContent = text
  node.style.fontSize = `${FONT_SIZE}px`
  node.style.opacity = String(OPACITY)
  stage.appendChild(node)

  const width = node.offsetWidth || 220
  const distance = window.innerWidth + width
  // 长句给足时间，短句也别一闪就没；设置里给了固定秒数就以它为准
  const duration = FIXED_SECONDS > 0
    ? FIXED_SECONDS
    : Math.max(4.5, Math.min(14, distance / SPEED))

  const lane = pickLane(duration)
  const laneHeight = Math.max(36, Math.floor(window.innerHeight / (LANES + 4)))
  node.style.top = `${laneHeight * (lane + 1)}px`
  node.style.animation = `dm-run ${duration.toFixed(2)}s linear forwards`

  node.addEventListener('animationend', () => node.remove(), { once: true })
}

if (typeof window.pet?.onDanmaku === 'function') {
  window.pet.onDanmaku((item) => show(item))
}
