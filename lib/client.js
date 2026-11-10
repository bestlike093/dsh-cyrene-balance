/**
 * dsh-cyrene-pet — 客户端半（Client half）。
 *
 * 在 dsh 设置页挂一张「昔涟 · 桌宠」卡片：看运行状态，
 * 启动 / 重启 / 关闭桌宠进程。真正干活的是宿主半的
 * /cyrene-pet/control 路由。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cyrene-pet',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PACKAGE_ID = 'dsh-cyrene-pet'
    const STATE_PATH = '/cyrene-pet/state'
    /* 单项恢复默认：只接受后端设置总表里登记过的 path */
    const SETTINGS_RESET_PATH = '/cyrene-pet/settings/reset'
    /* 最近改动：留最近 10 次写入，能单条回退 */
    const SETTINGS_HISTORY_PATH = '/cyrene-pet/settings/history'
    const SETTINGS_UNDO_PATH = '/cyrene-pet/settings/undo'
    /* 体检四灯：只报事实，不自动修 */
    const HEALTH_PATH = '/cyrene-pet/health'
    /* 向导四问走完的标记 */
    const WIZARD_PATH = '/cyrene-pet/settings/wizard'
    const BACKGROUNDS_PATH = '/cyrene-pet/backgrounds'
    const BACKGROUND_PATH = '/cyrene-pet/background'
    const CONTROL_PATH = '/cyrene-pet/control'
    const COMPANION_PATH = '/cyrene-pet/companion'
    const ABILITY_PATH = '/cyrene-pet/companion/ability'
    const SESSIONS_PATH = '/cyrene-pet/sessions'
    const SESSION_BIND_PATH = '/cyrene-pet/sessions/bind'
    const SESSION_HISTORY_PATH = '/cyrene-pet/sessions/history'
    const MEMORY_PATH = '/cyrene-pet/companion/memory'
    /* 自定义表情包：一套库，和内置共用同一份清单。 */
    const STICKER_CUSTOM_PATH = '/cyrene-pet/sticker/custom'
    const MEMORY_PIN_PATH = '/cyrene-pet/companion/memory/pin'
    const MEMORY_FORGET_PATH = '/cyrene-pet/companion/memory/forget'
    const MEMORY_EXPORT_PATH = '/cyrene-pet/companion/memory/export'
    const MEMORY_IMPORT_PATH = '/cyrene-pet/companion/memory/import'
    const MEMORY_SETTINGS_PATH = '/cyrene-pet/companion/memory/settings'
    const BACKUP_EXPORT_PATH = '/cyrene-pet/companion/backup/export'
    const BACKUP_RESTORE_PATH = '/cyrene-pet/companion/backup/restore'
    const VAULT_ROTATE_PATH = '/cyrene-pet/companion/vault/rotate'
    const VISION_TEST_PATH = '/cyrene-pet/vision/test'
    /* 游戏感知：只读进程名与外部工具状态，不启动游戏 */
    const GAMES_PATH = '/cyrene-pet/games'
    /* 同伴名单：主人 / 重要 / 次重要，键形如 qq:private:<openid> */
    const PEERS_PATH = '/cyrene-pet/companion/peers'
    const SLOT_LABELS = { identity: '身份', preference: '偏好', event: '事件', relation: '关系' }
    const RPS_OPTIONS = [
      { id: 'rock', label: '石头', mark: '✊' },
      { id: 'scissors', label: '剪刀', mark: '✌' },
      { id: 'paper', label: '布', mark: '🖐' },
    ]
    const RPS_LABELS = { rock: '石头', scissors: '剪刀', paper: '布' }
    /* 左侧配色：樱粉是基准，另两套只换底色和强调色 */
    const PALETTE_OPTIONS = [
      { id: 'sakura', label: '樱粉' },
      { id: 'plainpaper', label: '素纸' },
      { id: 'celadon', label: '青瓷' },
    ]

    const CSS = `
.cyp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
  /* 宿主设置页的容器可能不给滚动，卡片自己滚，绕开外层裁切 */
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  /* 设置卡片自己的底图：有就贴，没有就留纯色 */
  background-image: var(--cyp-card-image, none);
  background-size: var(--cyp-card-size, cover);
  background-position: var(--cyp-card-pos, 50% 50%);
  background-repeat: no-repeat;
  background-attachment: local;
  font-size: 13px;
  line-height: 1.6;
}
.cyp-card::-webkit-scrollbar { width: 8px; }
.cyp-card::-webkit-scrollbar-track { background: transparent; }
.cyp-card::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 42%, transparent);
}
.cyp-card::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 62%, transparent);
}
/* 左侧竖排导航 + 右侧单页内容；页签多了也只是一列往下排，和 DSH 本体的设置页同一个路子。 */
/* 设置搜索：跨页过滤，命中的项描一圈，没命中的先藏起来。 */
.cyp-search { margin-top: 10px; }
.cyp-search-input {
  width: 100%; box-sizing: border-box; padding: 8px 12px;
  border: 1px solid #eadfe6; border-radius: 10px; background: #fff;
  font-size: 13px; color: #3c3540;
}
.cyp-search-input:focus { outline: none; border-color: var(--cyp-accent, #e0709e); }
.cyp-panes[data-searching="1"] > [data-panel] { display: block !important; }
.cyp-set[data-miss="1"] { display: none !important; }
.cyp-set[data-hit="1"] { outline: 1px solid rgba(239, 107, 168, .55); outline-offset: 4px; border-radius: 8px; }
.cyp-set-tools { display: inline-flex; align-items: center; gap: 6px; }
.cyp-reset {
  appearance: none; border: 0; background: transparent; cursor: pointer;
  color: #b9a9b4; font-size: 14px; line-height: 1; padding: 2px 4px;
  opacity: 0; transition: opacity .15s ease, color .15s ease;
}
.cyp-set:hover .cyp-reset, .cyp-reset:focus-visible { opacity: 1; }
.cyp-reset:hover { color: var(--cyp-accent, #e0709e); }
.cyp-body { display: flex; gap: 12px; align-items: flex-start; margin-top: 10px; }
/* 六组导航：横向一行，窄时自己滚，不换行挤成一团 */
.cyp-groups { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.cyp-groups::-webkit-scrollbar { height: 4px; }
.cyp-groups::-webkit-scrollbar-thumb { background: color-mix(in srgb, currentColor 18%, transparent); border-radius: 4px; }
.cyp-group {
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  padding: 5px 11px;
  font: inherit;
  font-size: 12.5px;
  color: inherit;
  cursor: pointer;
  background: color-mix(in srgb, currentColor 6%, transparent);
  opacity: .78;
}
.cyp-group:hover { opacity: 1; }
.cyp-group[data-active="1"] {
  opacity: 1;
  font-weight: 600;
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 22%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cyp-accent, #e0709e) 45%, transparent);
}
/* 改完到底什么时候生效，先说在前面 */
.cyp-effect { padding: 0 2px; font-size: 11.5px; opacity: .72; }
.cyp-effect[data-restart="1"] { color: #b4691f; opacity: .95; }
/* 体检：一盏灯一个事实，红的不自动修 */
.cyp-light {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #d9534f;
  box-shadow: 0 0 0 3px color-mix(in srgb, #d9534f 18%, transparent);
}
.cyp-light[data-on="1"] {
  background: #3fa45b;
  box-shadow: 0 0 0 3px color-mix(in srgb, #3fa45b 18%, transparent);
}
/* 最近改动：一条一行，长值折行不撑破 */
.cyp-hist {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 4%, transparent);
}
.cyp-hist-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cyp-hist-time { font-size: 12px; opacity: .7; font-variant-numeric: tabular-nums; }
.cyp-hist-src { font-size: 12px; opacity: .85; }
.cyp-hist-head .cyp-btn { margin-left: auto; }
.cyp-hist-body { display: flex; flex-direction: column; gap: 2px; font-size: 12px; opacity: .85; }
.cyp-hist-item code { opacity: .8; }
.cyp-hist-item span { word-break: break-all; }
.cyp-tabs {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 0 0 84px;
  padding: 4px;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 5%, transparent);
  position: sticky;
  top: -18px;
  z-index: 1;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  backdrop-filter: blur(6px);
}
.cyp-tabs::-webkit-scrollbar { width: 4px; }
.cyp-tabs::-webkit-scrollbar-thumb { background: color-mix(in srgb, currentColor 18%, transparent); border-radius: 4px; }
.cyp-tab {
  padding: 5px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  white-space: nowrap;
  opacity: .62;
  cursor: pointer;
}
.cyp-tab:hover { opacity: .9; }
.cyp-tab[data-active="1"] {
  opacity: 1;
  font-weight: 600;
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 16%, transparent);
}
.cyp-panes { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.cyp-panel { display: flex; flex-direction: column; gap: 12px; }
/* 页内小节：游戏页把「感知 / 游戏时 / 陪看 / 弹幕 / 外部工具」分开，不堆平铺开关 */
.cyp-sec-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px dashed color-mix(in srgb, currentColor 14%, transparent);
}
.cyp-sec-title:first-child { margin-top: 0; padding-top: 0; border-top: none; }
.cyp-sec-name { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.cyp-sec-hint { font-size: 11.5px; opacity: 0.6; }
/* 单个设置项：左边标题、右边控件 */
.cyp-set { display: flex; flex-direction: column; gap: 3px; }
.cyp-set + .cyp-set { margin-top: 2px; }
.cyp-set-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cyp-set-label { font-size: 12.5px; font-weight: 500; }
.cyp-set-sub { opacity: .56; font-size: 11.5px; line-height: 1.5; }
.cyp-seg { display: flex; flex-wrap: wrap; gap: 4px; }
.cyp-seg-btn {
  padding: 4px 9px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  opacity: .72;
}
.cyp-seg-btn:hover { opacity: 1; }
.cyp-seg-btn[data-on="1"] {
  opacity: 1;
  border-color: color-mix(in srgb, var(--cyp-accent, #e0709e) 55%, transparent);
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 14%, transparent);
  font-weight: 600;
}
.cyp-switch {
  flex: none;
  width: 34px;
  height: 19px;
  padding: 2px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 20%, transparent);
  cursor: pointer;
  transition: background .16s ease;
}
.cyp-switch::after {
  content: "";
  display: block;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .22);
  transition: transform .16s ease;
}
.cyp-switch[data-on="1"] { background: var(--cyp-accent, #e0709e); }
.cyp-switch[data-on="1"]::after { transform: translateX(15px); }
.cyp-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
}
.cyp-range { width: 100%; min-width: 90px; accent-color: var(--cyp-accent, #e0709e); cursor: pointer; }
.cyp-num { flex: none; width: 46px; text-align: right; font-size: 11.5px; opacity: .7; font-variant-numeric: tabular-nums; }
.cyp-head { display: flex; flex-direction: column; gap: 4px; }
.cyp-title { display: flex; align-items: baseline; gap: 8px; font-size: 15px; font-weight: 600; letter-spacing: .02em; }
.cyp-version { opacity: .45; font-size: 11px; font-weight: 500; letter-spacing: .04em; }
.cyp-hint { opacity: .62; font-size: 12px; }
.cyp-state { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cyp-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .55; }
.cyp-dot[data-on="1"] { background: #3fbf7f; opacity: 1; }
.cyp-dot[data-err="1"] { background: #d9534f; opacity: 1; }
.cyp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cyp-btn {
  padding: 7px 16px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.cyp-btn:hover { background: color-mix(in srgb, var(--cyp-accent, #e0709e) 16%, transparent); }
.cyp-btn:disabled { opacity: .5; cursor: default; }
.cyp-btn[data-tone="primary"] {
  border-color: color-mix(in srgb, var(--cyp-accent, #e0709e) 40%, transparent);
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 14%, transparent);
}
.cyp-status { font-size: 12px; opacity: .7; }
.cyp-status[data-tone="err"] { color: #d9534f; opacity: .95; }
.cyp-note { font-size: 11px; opacity: .5; word-break: break-all; }
.cyp-companion {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 10px; border-radius: 10px;
  background: color-mix(in srgb, currentColor 3%, transparent);
}
.cyp-chip[data-tone="quiet"] { opacity: .55; }
.cyp-mem { border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 10px; }
.cyp-mem > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .85; }
.cyp-game { border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 10px; }
.cyp-game > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .85; }
.cyp-game-result { margin: 2px 0; font-size: 12px; }
.cyp-game-result[data-result="win"] { color: #2f9e6a; }
.cyp-game-result[data-result="lose"] { color: #c46a5a; }
.cyp-sessions { border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); padding-top: 10px; }
.cyp-sessions > summary { cursor: pointer; font-size: 12.5px; font-weight: 600; opacity: .85; }
.cyp-session-list { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.cyp-session-item {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding: 5px 7px; border: 1px solid transparent; border-radius: 8px;
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.cyp-session-item:hover { border-color: color-mix(in srgb, currentColor 14%, transparent); }
.cyp-session-item[data-active="1"] {
  border-color: color-mix(in srgb, var(--cyp-accent, #e0709e) 34%, transparent);
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 10%, transparent);
}
.cyp-session-run { flex: none; font-size: 10px; color: #2f9e6a; }
.cyp-session-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cyp-session-time { flex: none; font-size: 11px; opacity: .5; }
.cyp-preview {
  margin: 6px 0; padding: 8px 10px; border-radius: 8px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  max-height: 260px; overflow: auto;
}
.cyp-preview-item { margin: 3px 0; font-size: 12px; line-height: 1.55; word-break: break-word; }
.cyp-preview-item[data-role="assistant"] { opacity: .85; }
.cyp-preview-role { font-size: 10px; opacity: .5; margin-right: 5px; }
.cyp-chip {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.cyp-chip[data-active="1"] {
  border-color: currentColor;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.cyp-chip:disabled { opacity: .5; cursor: default; }
.cyp-range {
  width: 168px;
  accent-color: currentColor;
}
.cyp-look-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 10px 0 4px;
  padding-top: 8px;
  border-top: 1px dashed currentColor;
}
/* 图库：一格格摆，和表情包库一个形态 */
.cyp-bg-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px;
  max-height: 320px; overflow: auto; margin: 8px 0 2px;
}
.cyp-bg-tile {
  position: relative; width: 100%; aspect-ratio: 16 / 10; padding: 0;
  border-radius: 10px; overflow: hidden; cursor: pointer;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
}
.cyp-bg-tile[data-active="1"] {
  border-color: currentColor;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 22%, transparent);
}
.cyp-bg-tile img { display: block; width: 100%; height: 100%; object-fit: cover; }
.cyp-bg-tile-name {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 2px 6px; font-size: 10px; line-height: 1.5;
  color: #fff; background: linear-gradient(transparent, rgba(0, 0, 0, .55));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cyp-bg-tile-del {
  position: absolute; top: 4px; right: 4px; width: 20px; height: 20px;
  border-radius: 50%; border: none; cursor: pointer;
  background: rgba(20, 10, 20, .55); color: #fff; font-size: 12px; line-height: 1;
}
.cyp-bg-tile-del:disabled { opacity: .5; cursor: default; }
.cyp-bg-empty {
  margin: 8px 0;
  padding: 14px 10px; text-align: center; border-radius: 10px;
  border: 1px dashed color-mix(in srgb, currentColor 22%, transparent);
}
/* 取景：预览框按 16:9 裁，和真实页面同一套 cover + 百分比锚点 */
.cyp-crop {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
  padding-top: 8px;
  border-top: 1px dashed currentColor;
}
.cyp-crop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.cyp-crop-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background-color: #fff8fc;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 6%, transparent);
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.cyp-crop-preview:active { cursor: grabbing; }
.cyp-crop-preview img { display: block; width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.cyp-crop-shade { position: absolute; inset: 0; pointer-events: none; }
.cyp-crop-tip {
  position: absolute; left: 8px; bottom: 6px;
  font-size: 10px; color: #fff;
  background: rgba(20, 10, 20, .45); padding: 1px 6px; border-radius: 6px;
}
.cyp-crop-grid {
  display: grid;
  grid-template-columns: repeat(3, 40px);
  gap: 6px;
  justify-content: start;
}
.cyp-crop-dot {
  width: 40px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: transparent;
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}
.cyp-crop-dot[data-active="1"] {
  border-color: currentColor;
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.cyp-crop-dot:disabled { opacity: .5; cursor: default; }
.cyp-sticker-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 8px;
  max-height: 300px; overflow: auto; margin: 8px 0;
}
.cyp-sticker-card {
  display: flex; flex-direction: column; gap: 4px;
  padding: 6px; border-radius: 10px;
  background: color-mix(in srgb, currentColor 3%, transparent);
}
.cyp-sticker-thumb {
  width: 100%; aspect-ratio: 1 / 1; object-fit: contain;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 5%, transparent);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; opacity: .9;
}
.cyp-sticker-name {
  font-size: 11px; line-height: 1.3; text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cyp-mem-list { display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow: auto; margin: 8px 0; }
.cyp-mem-item {
  display: flex; align-items: flex-start; gap: 7px;
  padding: 7px 9px; border-radius: 9px;
  background: color-mix(in srgb, currentColor 3%, transparent);
}
.cyp-chip {
  flex: none; padding: 1px 7px; border-radius: 999px;
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 14%, transparent);
  font-size: 10.5px; opacity: .9;
}
.cyp-mem-text { flex: 1; font-size: 12px; line-height: 1.5; word-break: break-word; }
.cyp-mini {
  flex: none; padding: 2px 7px; border-radius: 7px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: transparent; color: inherit; font: inherit; font-size: 10.5px; cursor: pointer;
}
.cyp-mini:hover { background: color-mix(in srgb, var(--cyp-accent, #e0709e) 12%, transparent); }
.cyp-mem-form { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.cyp-input, .cyp-select {
  padding: 5px 8px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: inherit; font: inherit; font-size: 12px;
}
.cyp-input { flex: 1; min-width: 160px; }
.cyp-textarea {
  width: 100%; min-height: 46px; resize: vertical; box-sizing: border-box;
  padding: 6px 8px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: inherit; font: inherit; font-size: 11.5px; line-height: 1.5;
}
.cyp-label { display: block; margin-top: 8px; font-size: 11.5px; opacity: .85; }
.cyp-notice {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border-radius: 9px;
  background: color-mix(in srgb, var(--cyp-accent, #e0709e) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--cyp-accent, #e0709e) 28%, transparent);
  font-size: 12px;
}
.cyp-toggle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; }
.cyp-toggle input { accent-color: var(--cyp-accent, #e0709e); }
`

    function log(level, message, error) {
      const logger = typeof console !== 'undefined' ? console : null
      if (logger === null) return
      const fn = logger[level] ?? logger.log
      try {
        fn.call(logger, `[${PACKAGE_ID}] ${message}`, error ?? '')
      } catch {
        /* 控制台不可用时静默 */
      }
    }

    function api(path, init) {
      return fetch(new URL(path, window.location.origin).href, init).then((response) => response.json())
    }

    /* ---------------------------------------------------------------
       皮肤层（粉白毛玻璃）。

       作用域：body[data-cyrene-pet][data-pet-skin="on"]
       - 主题插件 dsh-cyrene-theme 在场时，installSkin 把属性写成 standby，
         这一整块选择器不匹配，自然让位，不会双重换肤。
       - 卸载时只摘自己的 style 节点和 body 属性，不动宿主任何东西。
       --------------------------------------------------------------- */
    const SKIN_CSS = `
body[data-cyrene-pet][data-pet-skin="on"] {
  --cyw-ink: #4a2b3f;
  --cyw-ink-soft: #87627a;
  --dsw-alias-bg-base: transparent;
  --dsw-alias-bg-layer-1: rgba(255, 240, 247, .74);
  --dsw-alias-bg-layer-2: rgba(255, 255, 255, .5);
  --dsw-alias-bg-layer-3: rgba(255, 255, 255, .4);
  --dsw-alias-bg-module-platform: rgba(255, 255, 255, .55);
  --dsw-alias-bg-overlay: rgba(255, 247, 252, .88);
  --dsw-alias-border-l1: rgba(239, 150, 192, .3);
  --dsw-alias-border-l2: color-mix(in srgb, var(--cyp-accent, #e0709e) 42%, transparent);
  --dsw-alias-border-l2-darkmode-thin: color-mix(in srgb, var(--cyp-accent, #e0709e) 22%, transparent);
  --dsw-alias-border-l3: color-mix(in srgb, var(--cyp-accent, #e0709e) 55%, transparent);
  --dsw-alias-border-l4: rgba(198, 74, 146, .7);
  --dsw-alias-brand-primary: #d94b86;
  --dsw-alias-brand-text: #ffffff;
  --dsw-alias-button-elevated-fill: rgba(255, 255, 255, .86);
  --dsw-alias-button-floating-fill: rgba(255, 250, 253, .94);
  --dsw-alias-button-floating-hover: #ffe3f0;
  --dsw-alias-button-info-fill: #d94b86;
  --dsw-alias-button-info-hover: #c33e77;
  --dsw-alias-interactive-bg-active: rgba(239, 107, 168, .2);
  --dsw-alias-interactive-bg-hover: rgba(239, 107, 168, .1);
  --dsw-alias-interactive-bg-hover-solid: #ffe6f2;
  --dsw-alias-label-caption: #806675;
  --dsw-alias-label-deep-diving: #aa4a87;
  --dsw-alias-label-dimmed: #c1a2b3;
  --dsw-alias-label-primary: #4a2b3f;
  --dsw-alias-label-primary-bluish: #5b3a58;
  --dsw-alias-label-primary-dimmed: #8a6076;
  --dsw-alias-label-primary-foreground: #ffffff;
  --dsw-alias-label-primary-inverted: #fff8fc;
  --dsw-alias-label-secondary: #87627a;
  --dsw-alias-label-tertiary: #826477;
  --dsw-alias-markdown-code-block: rgba(255, 255, 255, .62);
  --dsw-alias-menu-group-header-fill: rgba(255, 236, 246, .85);
  --dsw-alias-scrollbar-bg-l2: rgba(239, 107, 168, .18);
  --dsw-alias-scrollbar-hover-l2: rgba(239, 107, 168, .36);
  --dsw-alias-state-business-primary: #ac6dc0;
  --dsw-alias-state-business-tertiary: #f3e6fb;
  --dsw-alias-state-error-primary: #ba4459;
  --dsw-alias-state-idle-primary: #c3a3b5;
  --dsw-alias-state-success-primary: #3f946e;
  --dsw-alias-state-warn-primary: #b6774a;
  --dsw-alias-state-warn-label: #9a5f27;
  --dsw-alias-state-warn-tertiary: #fdeee0;
  --dsw-alias-tooltip-bg: rgba(74, 43, 63, .94);
  --dsw-specific-bubble: rgba(255, 255, 255, .55);
  --dsw-specific-input-major: rgba(255, 255, 255, .72);
  --dsw-specific-menu: rgba(255, 250, 253, .95);
  --dsw-specific-selector: rgba(255, 255, 255, .8);
  --dsw-specific-sidebar-fill: rgba(255, 226, 240, .78);
  --dsw-specific-sidebar-nav-item-active-accent: rgba(239, 107, 168, .16);
  --dsw-static-neutral-bluish-00: #fdf6fa;
  --dsw-shadow-lv2: 0 18px 48px color-mix(in srgb, var(--cyp-accent, #e0709e) 16%, transparent), 0 2px 8px color-mix(in srgb, var(--cyp-accent, #e0709e) 10%, transparent);
  background-color: transparent;
  color: var(--cyw-ink);
}

body[data-cyrene-pet][data-pet-skin="on"][data-ds-dark-theme] {
  --cyw-ink: #faeef5;
  --cyw-ink-soft: #cfa8bd;
  --dsw-alias-bg-base: transparent;
  --dsw-alias-bg-layer-1: rgba(58, 38, 54, .62);
  --dsw-alias-bg-layer-2: rgba(70, 46, 66, .5);
  --dsw-alias-bg-layer-3: rgba(84, 56, 78, .4);
  --dsw-alias-bg-module-platform: rgba(58, 38, 54, .55);
  --dsw-alias-bg-overlay: rgba(40, 26, 38, .9);
  --dsw-alias-border-l1: rgba(246, 170, 208, .22);
  --dsw-alias-border-l2: rgba(246, 170, 208, .32);
  --dsw-alias-border-l2-darkmode-thin: rgba(246, 170, 208, .16);
  --dsw-alias-border-l3: rgba(246, 170, 208, .45);
  --dsw-alias-border-l4: rgba(246, 170, 208, .6);
  --dsw-alias-brand-primary: #f7a6cd;
  --dsw-alias-brand-text: #2a1622;
  --dsw-alias-button-elevated-fill: rgba(74, 48, 68, .8);
  --dsw-alias-button-floating-fill: rgba(58, 36, 52, .92);
  --dsw-alias-button-floating-hover: rgba(92, 56, 80, .95);
  --dsw-alias-button-info-fill: var(--cyp-accent, #e0709e);
  --dsw-alias-button-info-hover: #f794c3;
  --dsw-alias-interactive-bg-active: rgba(247, 166, 205, .24);
  --dsw-alias-interactive-bg-hover: rgba(247, 166, 205, .14);
  --dsw-alias-interactive-bg-hover-solid: #4a2c40;
  --dsw-alias-label-caption: #b18fa3;
  --dsw-alias-label-deep-diving: #f7a6cd;
  --dsw-alias-label-dimmed: #9d7c90;
  --dsw-alias-label-primary: #faeef5;
  --dsw-alias-label-primary-bluish: #e9cedd;
  --dsw-alias-label-primary-dimmed: #cda9bd;
  --dsw-alias-label-primary-foreground: #2a1622;
  --dsw-alias-label-primary-inverted: #2a1622;
  --dsw-alias-label-secondary: #cfa8bd;
  --dsw-alias-label-tertiary: #b08fa2;
  --dsw-alias-markdown-code-block: rgba(30, 20, 28, .6);
  --dsw-alias-menu-group-header-fill: rgba(60, 36, 54, .9);
  --dsw-alias-scrollbar-bg-l2: rgba(247, 166, 205, .18);
  --dsw-alias-scrollbar-hover-l2: rgba(247, 166, 205, .38);
  --dsw-alias-state-business-primary: #c79ae6;
  --dsw-alias-state-business-tertiary: #3c2b48;
  --dsw-alias-state-error-primary: #f2708a;
  --dsw-alias-state-idle-primary: #8e6f81;
  --dsw-alias-state-success-primary: #6ccfa1;
  --dsw-alias-state-warn-primary: #eaa96f;
  --dsw-alias-state-warn-label: #f0b982;
  --dsw-alias-state-warn-tertiary: #43301f;
  --dsw-alias-tooltip-bg: rgba(255, 246, 251, .97);
  --dsw-specific-bubble: rgba(58, 36, 52, .5);
  --dsw-specific-input-major: rgba(54, 34, 50, .75);
  --dsw-specific-menu: rgba(40, 26, 38, .96);
  --dsw-specific-selector: rgba(52, 32, 48, .85);
  --dsw-specific-sidebar-fill: rgba(46, 28, 44, .58);
  --dsw-specific-sidebar-nav-item-active-accent: rgba(247, 166, 205, .18);
  --dsw-static-neutral-bluish-00: #2a1a26;
  --dsw-shadow-lv2: 0 20px 52px rgba(0, 0, 0, .45), 0 2px 10px rgba(0, 0, 0, .35);
  color: var(--cyw-ink);
}

/* 整页底色：直接画在 html 上。
   这里刻意不用 ::before / ::after 做全屏层——在宿主某些层叠上下文里，
   fixed + 负 z-index 的伪元素会跑到最上面，既挡住内容也吃掉点击。 */
html[data-cyrene-pet="1"][data-pet-skin="on"] {
  background-color: #fff8fc;
  background-image:
    radial-gradient(1100px 760px at 12% -6%, rgba(255, 196, 226, .95), rgba(255, 196, 226, 0) 62%),
    radial-gradient(900px 700px at 88% 4%, rgba(206, 190, 255, .8), rgba(206, 190, 255, 0) 60%),
    radial-gradient(760px 620px at 76% 96%, rgba(178, 220, 255, .65), rgba(178, 220, 255, 0) 62%),
    linear-gradient(158deg, #fff8fc 0%, #ffeef7 34%, #f7ecff 68%, #eef6ff 100%);
  background-attachment: fixed;
  background-repeat: no-repeat;
  background-size: cover;
}
html[data-cyrene-pet="1"][data-pet-skin="on"][data-ds-dark-theme] {
  background-color: #171018;
  background-image:
    radial-gradient(1000px 720px at 14% -8%, rgba(150, 72, 124, .75), rgba(150, 72, 124, 0) 62%),
    radial-gradient(880px 680px at 86% 2%, rgba(104, 86, 168, .7), rgba(104, 86, 168, 0) 60%),
    linear-gradient(158deg, #20141f 0%, #2a1727 36%, #241a33 70%, #1a1a2c 100%);
}
/* 只让 body 自己让开底色，不动宿主内部任何容器 */
body[data-cyrene-pet] {
  background-color: transparent;
}

/* ---------------- 背景图 ----------------
   仍然只写在 html 的 background-* 上，页面里不加任何层。
   模糊是在贴图之前用 canvas 做掉的，所以这里不需要 filter：
   fixed + 负 z-index 的伪元素在这套宿主里会浮到最上面，挡住内容和点击。 */
html[data-cyrene-pet="1"][data-pet-bg="on"] {
  background-color: #fff8fc;
  background-image:
    linear-gradient(rgba(var(--cyp-tint, 236, 138, 176), var(--cyp-tint-a, .55)), rgba(var(--cyp-tint, 236, 138, 176), var(--cyp-tint-a, .55))),
    linear-gradient(rgba(var(--cyp-veil, 255, 250, 253), var(--cyp-dim, .35)), rgba(var(--cyp-veil, 255, 250, 253), var(--cyp-dim, .35))),
    var(--cyp-bg-url, none);
  background-size: auto, auto, var(--cyp-bg-size, cover);
  /* 取景：posX/posY 是百分比锚点，用户在设置里挑完立刻能在这里看到 */
  background-position: center, center, var(--cyp-bg-pos, 50% 50%);
  background-repeat: no-repeat, no-repeat, no-repeat;
  background-attachment: fixed, fixed, fixed;
}
/*
 * 照片之上有两层：下层 veil 管明度（由 dim 控制），上层 tint 管配色。
 * 之前只有 veil，三套浅色叠在同一张照片上量化后几乎同色，换配色看起来像没反应；
 * 现在 tint 用各配色的饱和主色，强度由 appearance.paletteStrength 控制，
 * 调到 0 就退回“只有白纱”的老样子。
 * 变量必须落在 html 上，body 上设的变量 html 读不到。
 */
html[data-cyrene-pet="1"][data-pet-palette="sakura"] { --cyp-veil: 253, 231, 240; --cyp-tint: 240, 139, 180; --cyp-accent: #e0709e; }
html[data-cyrene-pet="1"][data-pet-palette="plainpaper"] { --cyp-veil: 238, 241, 244; --cyp-tint: 140, 154, 168; --cyp-accent: #5f6f7d; }
html[data-cyrene-pet="1"][data-pet-palette="celadon"] { --cyp-veil: 230, 241, 251; --cyp-tint: 111, 168, 220; --cyp-accent: #4a86c8; }
html[data-cyrene-pet="1"][data-pet-palette="sakura"][data-ds-dark-theme] { --cyp-veil: 30, 20, 28; --cyp-tint: 118, 56, 86; }
html[data-cyrene-pet="1"][data-pet-palette="plainpaper"][data-ds-dark-theme] { --cyp-veil: 28, 30, 34; --cyp-tint: 74, 84, 96; }
html[data-cyrene-pet="1"][data-pet-palette="celadon"][data-ds-dark-theme] { --cyp-veil: 18, 25, 36; --cyp-tint: 44, 86, 140; }
html[data-cyrene-pet="1"][data-pet-bg="on"][data-ds-dark-theme] {
  background-color: #171018;
  background-image:
    linear-gradient(rgba(var(--cyp-tint, 118, 44, 78), var(--cyp-tint-a, .5)), rgba(var(--cyp-tint, 118, 44, 78), var(--cyp-tint-a, .5))),
    linear-gradient(rgba(var(--cyp-veil, 28, 18, 32), var(--cyp-dim, .35)), rgba(var(--cyp-veil, 28, 18, 32), var(--cyp-dim, .35))),
    var(--cyp-bg-url, none);
  background-position: center, center, var(--cyp-bg-pos, 50% 50%);
  background-size: auto, auto, var(--cyp-bg-size, cover);
  background-repeat: no-repeat, no-repeat, no-repeat;
  background-attachment: fixed, fixed, fixed;
}
/* 铺了照片之后，正文加一层浅描边保证可读 */
body[data-cyrene-pet][data-pet-bg="on"] [data-conversation-scroll] :is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th) {
  text-shadow: 0 1px 2px rgba(255, 255, 255, .9), 0 0 10px rgba(255, 250, 253, .72);
}
body[data-cyrene-pet][data-pet-bg="on"][data-ds-dark-theme] [data-conversation-scroll] :is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th) {
  text-shadow: 0 1px 2px rgba(0, 0, 0, .7), 0 0 10px rgba(20, 10, 20, .6);
}

/* ---------------- 另外两套配色 ----------------
   只覆盖 token 和底色，版式一行不动。
   底色规则带 :not([data-pet-bg="on"])，铺了照片时让位给照片。
   素纸：米白、茶褐，适合长时间读字。
   青瓷：浅青灰、墨绿，安静一点。 */

html[data-cyrene-pet="1"][data-pet-skin="on"][data-pet-palette="sakura"]:not([data-pet-bg="on"]) {
  background-color: #fff6fa;
  background-image:
    radial-gradient(1040px 720px at 10% -8%, rgba(255, 226, 240, .92), rgba(255, 226, 240, 0) 62%),
    radial-gradient(900px 680px at 92% 2%, rgba(255, 235, 245, .88), rgba(255, 235, 245, 0) 60%),
    radial-gradient(760px 620px at 72% 98%, rgba(255, 220, 236, .62), rgba(255, 220, 236, 0) 62%);
}
html[data-cyrene-pet="1"][data-pet-skin="on"][data-pet-palette="plainpaper"]:not([data-pet-bg="on"]) {
  background-color: #fdfbfc;
  background-image:
    radial-gradient(1040px 720px at 10% -8%, rgba(233, 230, 235, .92), rgba(233, 230, 235, 0) 62%),
    radial-gradient(900px 680px at 92% 2%, rgba(241, 238, 242, .88), rgba(241, 238, 242, 0) 60%),
    radial-gradient(760px 620px at 72% 98%, rgba(236, 231, 235, .6), rgba(236, 231, 235, 0) 62%);
}
body[data-cyrene-pet][data-pet-skin="on"][data-pet-palette="sakura"] {
  --cyw-ink: #4a3540;
  --cyw-ink-soft: #8a707c;
  --dsw-alias-bg-layer-1: rgba(253, 231, 240, .8);
  --dsw-alias-bg-layer-2: rgba(255, 251, 253, .54);
  --dsw-alias-bg-layer-3: rgba(255, 251, 253, .44);
  --dsw-alias-bg-module-platform: rgba(255, 251, 253, .6);
  --dsw-alias-bg-overlay: rgba(255, 246, 250, .9);
  --dsw-alias-border-l1: rgba(240, 139, 180, .26);
  --dsw-alias-border-l2: rgba(224, 112, 158, .38);
  --dsw-alias-border-l2-darkmode-thin: rgba(224, 112, 158, .2);
  --dsw-alias-border-l3: rgba(200, 88, 138, .52);
  --dsw-alias-border-l4: rgba(178, 70, 120, .66);
  --dsw-alias-brand-primary: #e0709e;
  --dsw-alias-button-elevated-fill: rgba(255, 251, 253, .88);
  --dsw-alias-button-floating-fill: rgba(255, 250, 252, .94);
  --dsw-alias-button-floating-hover: #fde7f0;
  --dsw-alias-button-info-fill: #e0709e;
  --dsw-alias-button-info-hover: #d05c8c;
  --dsw-alias-interactive-bg-active: rgba(224, 112, 158, .18);
  --dsw-alias-interactive-bg-hover: rgba(224, 112, 158, .09);
  --dsw-alias-interactive-bg-hover-solid: #fde7f0;
  --dsw-alias-label-caption: #8a707c;
  --dsw-alias-label-deep-diving: #b8507e;
  --dsw-alias-label-dimmed: #c4aab6;
  --dsw-alias-label-primary: #4a3540;
  --dsw-alias-label-primary-bluish: #4f3a46;
  --dsw-alias-label-primary-dimmed: #7c6470;
  --dsw-alias-label-primary-inverted: #fff6fa;
  --dsw-alias-label-secondary: #8a707c;
  --dsw-alias-label-tertiary: #977c88;
  --dsw-alias-markdown-code-block: rgba(255, 251, 253, .64);
  --dsw-alias-menu-group-header-fill: rgba(253, 231, 240, .9);
  --dsw-alias-scrollbar-bg-l2: rgba(224, 112, 158, .18);
  --dsw-alias-scrollbar-hover-l2: rgba(224, 112, 158, .34);
  --dsw-alias-state-business-primary: #8a6fb0;
  --dsw-alias-state-business-tertiary: #f0ecf9;
  --dsw-alias-tooltip-bg: rgba(74, 53, 64, .94);
  --dsw-specific-bubble: rgba(255, 255, 255, .58);
  --dsw-specific-input-major: rgba(255, 255, 255, .74);
  --dsw-specific-menu: rgba(255, 250, 253, .96);
  --dsw-specific-selector: rgba(255, 255, 255, .82);
  --dsw-specific-sidebar-fill: rgba(253, 231, 240, .82);
  --dsw-specific-sidebar-nav-item-active-accent: rgba(224, 112, 158, .16);
  --dsw-static-neutral-bluish-00: #fff6fa;
  --dsw-shadow-lv2: 0 18px 48px rgba(190, 86, 140, .14), 0 2px 8px rgba(190, 86, 140, .08);
}
body[data-cyrene-pet][data-pet-skin="on"][data-pet-palette="plainpaper"] {
  --cyw-ink: #2a3038;
  --cyw-ink-soft: #6a7683;
  --dsw-alias-bg-layer-1: rgba(238, 241, 244, .8);
  --dsw-alias-bg-layer-2: rgba(252, 251, 252, .54);
  --dsw-alias-bg-layer-3: rgba(252, 251, 252, .44);
  --dsw-alias-bg-module-platform: rgba(252, 251, 252, .6);
  --dsw-alias-bg-overlay: rgba(249, 247, 248, .9);
  --dsw-alias-border-l1: rgba(140, 154, 168, .28);
  --dsw-alias-border-l2: rgba(95, 111, 125, .4);
  --dsw-alias-border-l2-darkmode-thin: rgba(95, 111, 125, .2);
  --dsw-alias-border-l3: rgba(78, 92, 105, .52);
  --dsw-alias-border-l4: rgba(62, 74, 86, .66);
  --dsw-alias-brand-primary: #5f6f7d;
  --dsw-alias-button-elevated-fill: rgba(252, 251, 252, .88);
  --dsw-alias-button-floating-fill: rgba(251, 250, 251, .94);
  --dsw-alias-button-floating-hover: #eef1f4;
  --dsw-alias-button-info-fill: #5f6f7d;
  --dsw-alias-button-info-hover: #4e5c68;
  --dsw-alias-interactive-bg-active: rgba(95, 111, 125, .18);
  --dsw-alias-interactive-bg-hover: rgba(95, 111, 125, .09);
  --dsw-alias-interactive-bg-hover-solid: #eef1f4;
  --dsw-alias-label-caption: #6a7683;
  --dsw-alias-label-deep-diving: #47535f;
  --dsw-alias-label-dimmed: #a8b2bc;
  --dsw-alias-label-primary: #2a3038;
  --dsw-alias-label-primary-bluish: #2f3740;
  --dsw-alias-label-primary-dimmed: #5b6672;
  --dsw-alias-label-primary-inverted: #fdfbfc;
  --dsw-alias-label-secondary: #6a7683;
  --dsw-alias-label-tertiary: #76828f;
  --dsw-alias-markdown-code-block: rgba(252, 251, 252, .66);
  --dsw-alias-menu-group-header-fill: rgba(238, 241, 244, .9);
  --dsw-alias-scrollbar-bg-l2: rgba(95, 111, 125, .18);
  --dsw-alias-scrollbar-hover-l2: rgba(95, 111, 125, .34);
  --dsw-alias-state-business-primary: #7a6fb0;
  --dsw-alias-state-business-tertiary: #eeecf9;
  --dsw-alias-tooltip-bg: rgba(42, 48, 56, .94);
  --dsw-specific-bubble: rgba(255, 255, 255, .58);
  --dsw-specific-input-major: rgba(255, 255, 255, .74);
  --dsw-specific-menu: rgba(250, 249, 250, .96);
  --dsw-specific-selector: rgba(255, 255, 255, .82);
  --dsw-specific-sidebar-fill: rgba(238, 241, 244, .82);
  --dsw-specific-sidebar-nav-item-active-accent: rgba(95, 111, 125, .16);
  --dsw-static-neutral-bluish-00: #fdfbfc;
  --dsw-shadow-lv2: 0 18px 48px rgba(42, 48, 56, .14), 0 2px 8px rgba(42, 48, 56, .08);
}

html[data-cyrene-pet="1"][data-pet-skin="on"][data-pet-palette="celadon"]:not([data-pet-bg="on"]) {
  background-color: #f6faff;
  background-image:
    radial-gradient(1040px 720px at 10% -8%, rgba(198, 224, 246, .9), rgba(198, 224, 246, 0) 62%),
    radial-gradient(900px 680px at 92% 2%, rgba(208, 227, 246, .8), rgba(208, 227, 246, 0) 60%),
    radial-gradient(760px 620px at 72% 98%, rgba(216, 234, 250, .6), rgba(216, 234, 250, 0) 62%);
}
body[data-cyrene-pet][data-pet-skin="on"][data-pet-palette="celadon"] {
  --cyw-ink: #2f3b47;
  --cyw-ink-soft: #6b7c8c;
  --dsw-alias-bg-layer-1: rgba(230, 241, 251, .8);
  --dsw-alias-bg-layer-2: rgba(252, 253, 255, .54);
  --dsw-alias-bg-layer-3: rgba(252, 253, 255, .44);
  --dsw-alias-bg-module-platform: rgba(252, 253, 255, .6);
  --dsw-alias-bg-overlay: rgba(246, 250, 255, .9);
  --dsw-alias-border-l1: rgba(111, 168, 220, .26);
  --dsw-alias-border-l2: rgba(74, 134, 200, .36);
  --dsw-alias-border-l2-darkmode-thin: rgba(74, 134, 200, .18);
  --dsw-alias-border-l3: rgba(58, 108, 166, .5);
  --dsw-alias-border-l4: rgba(46, 88, 138, .62);
  --dsw-alias-brand-primary: #4a86c8;
  --dsw-alias-button-elevated-fill: rgba(252, 253, 255, .9);
  --dsw-alias-button-floating-fill: rgba(250, 253, 255, .94);
  --dsw-alias-button-floating-hover: #e2eefb;
  --dsw-alias-button-info-fill: #4a86c8;
  --dsw-alias-button-info-hover: #3c72b0;
  --dsw-alias-interactive-bg-active: rgba(74, 134, 200, .18);
  --dsw-alias-interactive-bg-hover: rgba(74, 134, 200, .09);
  --dsw-alias-interactive-bg-hover-solid: #e6f1fb;
  --dsw-alias-label-caption: #6b7c8c;
  --dsw-alias-label-deep-diving: #2f6aa8;
  --dsw-alias-label-dimmed: #a9bccd;
  --dsw-alias-label-primary: #2f3b47;
  --dsw-alias-label-primary-bluish: #33414f;
  --dsw-alias-label-primary-dimmed: #5f7180;
  --dsw-alias-label-primary-inverted: #f6faff;
  --dsw-alias-label-secondary: #6b7c8c;
  --dsw-alias-label-tertiary: #78889a;
  --dsw-alias-markdown-code-block: rgba(252, 253, 255, .64);
  --dsw-alias-menu-group-header-fill: rgba(228, 240, 250, .9);
  --dsw-alias-scrollbar-bg-l2: rgba(74, 134, 200, .18);
  --dsw-alias-scrollbar-hover-l2: rgba(74, 134, 200, .34);
  --dsw-alias-state-business-primary: #7a6fb0;
  --dsw-alias-state-business-tertiary: #eeecf9;
  --dsw-alias-tooltip-bg: rgba(47, 59, 71, .94);
  --dsw-specific-bubble: rgba(255, 255, 255, .58);
  --dsw-specific-input-major: rgba(255, 255, 255, .74);
  --dsw-specific-menu: rgba(248, 252, 255, .96);
  --dsw-specific-selector: rgba(255, 255, 255, .82);
  --dsw-specific-sidebar-fill: rgba(224, 238, 251, .82);
  --dsw-specific-sidebar-nav-item-active-accent: rgba(74, 134, 200, .16);
  --dsw-static-neutral-bluish-00: #f6faff;
  --dsw-shadow-lv2: 0 18px 48px rgba(74, 134, 200, .14), 0 2px 8px rgba(74, 134, 200, .08);
}

/* 暗色下只换强调色，底色继续走原来的深夜调 */
body[data-cyrene-pet][data-pet-skin="on"][data-ds-dark-theme][data-pet-palette="plainpaper"] {
  --cyw-ink: #e8ecf1;
  --cyw-ink-soft: #a9b5c1;
  --dsw-alias-brand-primary: #8c9aa8;
  --dsw-alias-button-info-fill: #8c9aa8;
  --dsw-alias-button-info-hover: #7a8794;
  --dsw-alias-border-l1: rgba(140, 154, 168, .24);
  --dsw-alias-border-l2: rgba(140, 154, 168, .34);
}
body[data-cyrene-pet][data-pet-skin="on"][data-ds-dark-theme][data-pet-palette="celadon"] {
  --cyw-ink: #e6eef8;
  --cyw-ink-soft: #a7bcd4;
  --dsw-alias-brand-primary: #6fa8dc;
  --dsw-alias-button-info-fill: #6fa8dc;
  --dsw-alias-button-info-hover: #5a97cf;
  --dsw-alias-border-l1: rgba(111, 168, 220, .24);
  --dsw-alias-border-l2: rgba(111, 168, 220, .34);
}

/* ---- 高优先级接管 ---------------------------------------------------
   与主题插件同时在场时，对方的 body 级规则可能后写而压住我们。
   这里多一层 html 前缀把特异性抬上去，只覆盖颜色 token，不碰布局。 */
html[data-cyrene-pet] body[data-cyrene-pet][data-pet-skin="on"][data-pet-palette="sakura"]:not([data-ds-dark-theme]) {
  --dsw-alias-bg-layer-1: rgba(253, 231, 240, .8);
  --dsw-alias-bg-layer-2: rgba(255, 242, 248, .68);
  --dsw-alias-bg-layer-3: rgba(255, 248, 251, .56);
  --dsw-alias-bg-module-platform: rgba(255, 236, 244, .74);
  --dsw-alias-bg-overlay: rgba(255, 246, 250, .94);
  --dsw-alias-border-l1: rgba(240, 139, 180, .3);
  --dsw-alias-border-l2: rgba(224, 112, 158, .4);
  --dsw-alias-brand-primary: #e0709e;
  --dsw-specific-sidebar-fill: rgba(253, 231, 240, .82);
  --dsw-specific-bubble: rgba(255, 255, 255, .86);
  --dsw-specific-input-major: rgba(255, 255, 255, .9);
  --dsw-specific-menu: rgba(255, 250, 253, .97);
  --dsw-specific-selector: rgba(255, 255, 255, .92);
}
html[data-cyrene-pet] body[data-cyrene-pet][data-pet-skin="on"][data-pet-palette="plainpaper"]:not([data-ds-dark-theme]) {
  --dsw-alias-bg-layer-1: rgba(238, 241, 244, .8);
  --dsw-alias-bg-layer-2: rgba(243, 245, 247, .68);
  --dsw-alias-bg-layer-3: rgba(248, 249, 250, .56);
  --dsw-alias-bg-module-platform: rgba(240, 243, 246, .74);
  --dsw-alias-bg-overlay: rgba(249, 247, 248, .94);
  --dsw-alias-border-l1: rgba(140, 154, 168, .3);
  --dsw-alias-border-l2: rgba(95, 111, 125, .4);
  --dsw-alias-brand-primary: #5f6f7d;
  --dsw-specific-sidebar-fill: rgba(238, 241, 244, .82);
  --dsw-specific-bubble: rgba(255, 255, 255, .86);
  --dsw-specific-input-major: rgba(255, 255, 255, .9);
  --dsw-specific-menu: rgba(250, 249, 250, .97);
  --dsw-specific-selector: rgba(255, 255, 255, .92);
}
html[data-cyrene-pet] body[data-cyrene-pet][data-pet-skin="on"][data-pet-palette="celadon"]:not([data-ds-dark-theme]) {
  --dsw-alias-bg-layer-1: rgba(230, 241, 251, .8);
  --dsw-alias-bg-layer-2: rgba(238, 246, 253, .68);
  --dsw-alias-bg-layer-3: rgba(244, 250, 254, .56);
  --dsw-alias-bg-module-platform: rgba(234, 244, 252, .74);
  --dsw-alias-bg-overlay: rgba(246, 250, 255, .94);
  --dsw-alias-border-l1: rgba(111, 168, 220, .3);
  --dsw-alias-border-l2: rgba(74, 134, 200, .4);
  --dsw-alias-brand-primary: #4a86c8;
  --dsw-specific-sidebar-fill: rgba(224, 238, 251, .82);
  --dsw-specific-bubble: rgba(255, 255, 255, .86);
  --dsw-specific-input-major: rgba(255, 255, 255, .9);
  --dsw-specific-menu: rgba(246, 250, 255, .97);
  --dsw-specific-selector: rgba(255, 255, 255, .92);
}
`

    /* 背景模糊：先在 canvas 里把图揉软，再把结果贴到 html 上。
       这样页面里不用加任何覆盖层，也不会碰到 fixed + 负 z-index 那个老问题。
       同一张图同一个模糊度只算一次，拖动滑杆来回走不会重复解码。 */
    const bgBlurCache = new Map()

    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('image-load-failed'))
        img.src = url
      })
    }

    async function composeBgUrl(id, blur) {
      const plain = `${BACKGROUND_PATH}/${encodeURIComponent(id)}`
      const px = Math.min(Math.max(Number(blur) || 0, 0), 24)
      if (id === '' || px === 0) return plain
      const key = `${id}|${px}`
      const hit = bgBlurCache.get(key)
      if (hit !== undefined) return hit
      const img = await loadImage(plain)
      /* 大图先缩到 1920 宽再模糊，画面看不出差别，算起来快很多。 */
      const naturalWidth = img.naturalWidth || 1920
      const naturalHeight = img.naturalHeight || 1080
      const scale = Math.min(1, 1920 / Math.max(naturalWidth, 1))
      const width = Math.max(1, Math.round(naturalWidth * scale))
      const height = Math.max(1, Math.round(naturalHeight * scale))
      const pad = Math.ceil(px * scale) + 2
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const painter = canvas.getContext('2d')
      if (painter === null) return plain
      painter.filter = `blur(${(px * scale).toFixed(2)}px)`
      /* 往外多铺一圈，模糊后的边缘才不会透出底色。 */
      painter.drawImage(img, -pad, -pad, width + pad * 2, height + pad * 2)
      const url = canvas.toDataURL('image/jpeg', 0.9)
      bgBlurCache.set(key, url)
      return url
    }

    /* cover 之后再按 zoom 放大，得算成具体像素——background-size 没有「cover × N」这种写法。
       取景器里的预览和真实页面用同一个函数，看到什么就是铺上去的样子。 */
    function bgCoverSize(zoom, imgW, imgH, boxW, boxH) {
      const z = Math.min(3, Math.max(1, Number(zoom) || 1))
      const w = Number(imgW) || 0
      const h = Number(imgH) || 0
      const cw = Number(boxW) || 1280
      const ch = Number(boxH) || 800
      if (w <= 0 || h <= 0) return 'cover'
      const k = Math.max(cw / w, ch / h) * z
      return `${Math.round(w * k)}px ${Math.round(h * k)}px`
    }

    /** 主题插件在场时让位：检测 body 上有没有它的作用域属性。 */
    function themePluginPresent() {
      try {
        return document.body.hasAttribute('data-dsh-cyrene')
          || document.body.hasAttribute('data-cyrene-skin')
      } catch {
        return false
      }
    }

    function apply(ctx) {
      let react = null
      try {
        react = require('react')
      } catch (error) {
        log('warn', 'React 不可用，设置页卡片已跳过', error)
        return
      }
      const h = react.createElement

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin-css', PACKAGE_ID)
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, `${PACKAGE_ID}: stylesheet`)

      /* 皮肤层独立挂载：不依赖设置页是否被打开。 */
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.setAttribute('data-plugin-css', `${PACKAGE_ID}-skin`)
        tag.textContent = SKIN_CSS
        document.head.appendChild(tag)

        const body = document.body
        const root = document.documentElement
        let wanted = true
        /* 配色单独记一份：sync 会被 MutationObserver 随时调到 */
        let palette = 'sakura'

        /* 两种状态：
           on  —— 本插件接管 token
           off —— 用户关了皮肤
           theme 在场时不再让位：DSH 的配色与背景归我们自己的 theme 板块，
           只在 body 上留一个 peer 标记，供设置页提示「两边都铺背景会叠图」。 */
        const sync = () => {
          const mode = wanted ? 'on' : 'off'
          body.setAttribute('data-cyrene-pet', '1')
          body.setAttribute('data-pet-skin', mode)
          body.setAttribute('data-pet-palette', palette)
          body.setAttribute('data-pet-theme-peer', themePluginPresent() ? '1' : '0')
          root.setAttribute('data-cyrene-pet', '1')
          root.setAttribute('data-pet-skin', mode)
          root.setAttribute('data-pet-palette', palette)
        }
        sync()

        /* 主题插件可能比我们晚加载，出现/消失时都重新判定一次 */
        let observer = null
        try {
          observer = new MutationObserver(sync)
          observer.observe(body, { attributes: true, attributeFilter: ['data-dsh-cyrene'] })
        } catch (error) {
          log('warn', '皮肤让位观察器不可用，按当前状态运行', error)
        }

        const readLook = () => {
          api(`${STATE_PATH}?t=${Date.now()}`)
            .then((state) => {
              /* 接口统一包了一层 { ok, value }；直接读外层永远拿不到字段，
                 配色会一直卡在初始值 sakura。 */
              const look = state && state.value ? state.value : state
              wanted = look?.appearance?.skin !== 'off'
              const next = look?.appearance?.palette
              palette = next === 'plainpaper' || next === 'celadon' ? next : 'sakura'
              /* 配色纱的强度：不写死在 CSS 里，用户能从设置里调；
                 0 等于只剩白纱，0.85 是配色明显盖过照片的上限。 */
              const rawA = Number(look?.appearance?.paletteStrength)
              const strength = Number.isFinite(rawA) ? Math.min(0.85, Math.max(0, rawA)) : 0.55
              root.style.setProperty('--cyp-tint-a', strength.toFixed(2))
              sync()
            })
            .catch(() => {})
        }
        readLook()

        /* 桌宠那边的配色不走 DSH 设置页，没有广播可听：定时对一次，
           改完那边三秒内这边就跟着变，不用手动刷新。 */
        try {
          setInterval(readLook, 3000)
        } catch (error) {
          log('warn', '配色轮询未启动，改完要刷新才生效', error)
        }

        /* 设置页改完配色会广播一次，这里跟着换，不用刷新 */
        let onChange = null
        try {
          onChange = () => readLook()
          window.addEventListener(`${PACKAGE_ID}:appearance`, onChange)
        } catch (error) {
          log('warn', '外观事件监听失败，配色要刷新才生效', error)
        }

        return () => {
          try { observer?.disconnect() } catch { /* 已断开 */ }
          try { if (onChange !== null) window.removeEventListener(`${PACKAGE_ID}:appearance`, onChange) } catch { /* 已移除 */ }
          tag.remove()
          body.removeAttribute('data-cyrene-pet')
          body.removeAttribute('data-pet-skin')
          body.removeAttribute('data-pet-palette')
          root.removeAttribute('data-pet-palette')
        }
      }, `${PACKAGE_ID}: skin`)

      /* ---- 主题接轨：通过官方 ctx.theme.overrideTokens 把配色折入 DSH 主题快照 ----
         只接管强调色 / 边框这些「一眼能看出换色」的 alias token，明暗成对给出；
         底色与组件精细配色继续走上面的 CSS 皮肤，避免和明暗主题打架。
         overrideTokens 是叠加层，不碰 light/dark 偏好，也不碰 dsh-cyrene-theme。 */
      const THEME_TOKENS = {
        sakura: {
          '--dsw-alias-brand-primary': { light: '#e0709e', dark: '#f08bb4' },
          '--dsw-alias-border-l1': { light: 'rgba(240, 139, 180, .3)', dark: 'rgba(240, 139, 180, .24)' },
          '--dsw-alias-border-l2': { light: 'rgba(224, 112, 158, .42)', dark: 'rgba(240, 139, 180, .34)' }
        },
        plainpaper: {
          '--dsw-alias-brand-primary': { light: '#5f6f7d', dark: '#8c9aa8' },
          '--dsw-alias-border-l1': { light: 'rgba(140, 154, 168, .3)', dark: 'rgba(140, 154, 168, .24)' },
          '--dsw-alias-border-l2': { light: 'rgba(95, 111, 125, .42)', dark: 'rgba(140, 154, 168, .34)' }
        },
        celadon: {
          '--dsw-alias-brand-primary': { light: '#4a86c8', dark: '#6fa8dc' },
          '--dsw-alias-border-l1': { light: 'rgba(111, 168, 220, .3)', dark: 'rgba(111, 168, 220, .24)' },
          '--dsw-alias-border-l2': { light: 'rgba(74, 134, 200, .42)', dark: 'rgba(111, 168, 220, .34)' }
        }
      }

      ctx.effect(() => {
        if (typeof ctx.theme?.overrideTokens !== 'function') return
        let dispose = null
        let current = ''
        const normalize = (value) => (value === 'plainpaper' || value === 'celadon' ? value : 'sakura')
        const applyTheme = (key) => {
          try {
            dispose = ctx.theme.overrideTokens(PACKAGE_ID, THEME_TOKENS[key])
            current = key
          } catch (error) {
            log('warn', '主题 token 覆盖失败，配色走 CSS 皮肤兜底', error)
          }
        }
        const read = () => api(`${STATE_PATH}?t=${Date.now()}`)
          .then((state) => {
            /* 与皮肤层同一份数据：接口包了 { ok, value }，不解包会一直判成 sakura，
               和 CSS 皮肤的天青来回打架，界面就会闪。 */
            const look = state && state.value ? state.value : state
            const key = normalize(look?.appearance?.palette)
            if (key !== current) applyTheme(key)
          })
          .catch(() => {})
        read()
        const timer = setInterval(read, 3000)
        const onChange = () => read()
        try { window.addEventListener(`${PACKAGE_ID}:appearance`, onChange) } catch { /* 事件不可用 */ }
        return () => {
          clearInterval(timer)
          try { window.removeEventListener(`${PACKAGE_ID}:appearance`, onChange) } catch { /* 已移除 */ }
          try { dispose?.() } catch { /* 已移除 */ }
        }
      }, `${PACKAGE_ID}: theme tokens`)

      /* 背景图：只用 html 的 background-image，页面里不插任何元素。
         page 槽决定这一页铺什么、多暗、取景停在哪、放多大；四个槽各存各的，互不覆盖。 */
      ctx.effect(() => {
        const root = document.documentElement

        /* cover 之后还要能放大：先算铺满需要多大，再乘 zoom，写成具体像素。
           CSS 的 background-size 没有「cover 再乘 N」的写法，只能自己算。 */
        const sizeFor = (zoom, imgW, imgH) => {
          const cw = window.innerWidth || 1280
          const ch = window.innerHeight || 800
          if (!imgW || !imgH) return 'cover'
          const k = Math.max(cw / imgW, ch / imgH) * zoom
          return `${Math.round(imgW * k)}px ${Math.round(imgH * k)}px`
        }

        const paint = (slot, url) => {
          const dim = Number(slot?.dim)
          root.style.setProperty('--cyp-dim', String(Number.isFinite(dim) ? Math.min(0.85, Math.max(0, dim)) : 0.35))
          const px = Number.isFinite(Number(slot?.posX)) ? Math.min(100, Math.max(0, Number(slot.posX))) : 50
          const py = Number.isFinite(Number(slot?.posY)) ? Math.min(100, Math.max(0, Number(slot.posY))) : 50
          root.style.setProperty('--cyp-bg-pos', `${px}% ${py}%`)
          const zoom = Number.isFinite(Number(slot?.zoom)) ? Math.min(3, Math.max(1, Number(slot.zoom))) : 1
          if (!slot?.id || url === '') {
            root.removeAttribute('data-pet-bg')
            root.style.removeProperty('--cyp-bg-url')
            root.style.removeProperty('--cyp-bg-size')
            return
          }
          root.style.setProperty('--cyp-bg-url', `url("${url}")`)
          root.setAttribute('data-pet-bg', 'on')
          const probe = new Image()
          probe.onload = () => {
            root.style.setProperty('--cyp-bg-size', sizeFor(zoom, probe.naturalWidth, probe.naturalHeight))
          }
          probe.onerror = () => root.style.setProperty('--cyp-bg-size', 'cover')
          probe.src = url
        }

        let signature = ''
        const sync = () => {
          api(`${BACKGROUNDS_PATH}?t=${Date.now()}`)
            .then(async (data) => {
              const slot = data?.active?.slots?.page ?? {}
              const id = typeof slot.id === 'string' ? slot.id : ''
              const blur = Number(data?.appearance?.bgBlur) || 0
              const next = [id, blur, slot.dim, slot.posX, slot.posY, slot.zoom,
                window.innerWidth, window.innerHeight].join('|')
              if (next === signature) return
              signature = next
              let url = ''
              if (id !== '') {
                try {
                  url = await composeBgUrl(id, blur)
                } catch (error) {
                  log('warn', '背景模糊合成失败，先铺原图', error)
                  url = `${BACKGROUND_PATH}/${encodeURIComponent(id)}`
                }
              }
              paint(slot, url)
            })
            .catch((error) => log('warn', '背景清单读取失败，只保留渐变底', error))
        }
        sync()
        /* 设置页改完这里要跟着变，不能等下次开 DSH；节奏和配色那条一致。 */
        const timer = setInterval(sync, 2000)
        return () => {
          clearInterval(timer)
          root.removeAttribute('data-pet-bg')
          root.style.removeProperty('--cyp-bg-url')
          root.style.removeProperty('--cyp-dim')
          root.style.removeProperty('--cyp-bg-size')
        }
      }, `${PACKAGE_ID}: background`)

      /* 设置卡片底图：卡片是 React 渲染的，尺寸要等挂上来才知道，所以跟着轮询补。
         只认 settingsCard 这一槽，和页面、桌宠窗口互不影响。 */
      ctx.effect(() => {
        const root = document.documentElement
        let signature = ''
        const sync = () => {
          api(`${BACKGROUNDS_PATH}?t=${Date.now()}`)
            .then((data) => {
              const slot = data?.active?.slots?.settingsCard ?? {}
              const id = typeof slot.id === 'string' ? slot.id : ''
              const next = [id, slot.dim, slot.posX, slot.posY, slot.zoom].join('|')
              if (next === signature) return
              signature = next
              if (id === '') {
                root.style.removeProperty('--cyp-card-image')
                root.style.removeProperty('--cyp-card-pos')
                root.style.removeProperty('--cyp-card-size')
                return
              }
              const posX = Number.isFinite(Number(slot.posX)) ? Math.min(100, Math.max(0, Number(slot.posX))) : 50
              const posY = Number.isFinite(Number(slot.posY)) ? Math.min(100, Math.max(0, Number(slot.posY))) : 50
              const zoom = Number.isFinite(Number(slot.zoom)) ? Math.min(3, Math.max(1, Number(slot.zoom))) : 1
              const dim = Number.isFinite(Number(slot.dim)) ? Math.min(0.85, Math.max(0, Number(slot.dim))) : 0.35
              const url = `${BACKGROUND_PATH}/${encodeURIComponent(id)}`
              root.style.setProperty('--cyp-card-image',
                `linear-gradient(rgba(255, 250, 253, ${dim}), rgba(255, 250, 253, ${dim})), url("${url}")`)
              root.style.setProperty('--cyp-card-pos', `${posX}% ${posY}%`)
              const probe = new Image()
              probe.onload = () => {
                const card = document.querySelector('.cyp-card')
                const rect = card?.getBoundingClientRect()
                root.style.setProperty('--cyp-card-size', bgCoverSize(
                  zoom, probe.naturalWidth, probe.naturalHeight, rect?.width, rect?.height))
              }
              probe.onerror = () => root.style.setProperty('--cyp-card-size', 'cover')
              probe.src = url
            })
            .catch(() => {})
        }
        sync()
        const timer = setInterval(sync, 2000)
        return () => {
          clearInterval(timer)
          root.style.removeProperty('--cyp-card-image')
          root.style.removeProperty('--cyp-card-pos')
          root.style.removeProperty('--cyp-card-size')
        }
      }, `${PACKAGE_ID}: card background`)

      function PetSection() {
        const [state, setState] = react.useState(null)
        const [status, setStatus] = react.useState('')
        const [tone, setTone] = react.useState('')
        const [busy, setBusy] = react.useState('')
        const [tab, setTab] = react.useState('overview')
        /* 六组导航：tab 仍然是具体面板，group 只决定左栏亮哪一组。
           切组时落到该组第一页，搜索时不看组。 */
        const [group, setGroup] = react.useState('self')
        /* 最近改动与体检：进页时才拉，省一次启动请求 */
        const [historyItems, setHistoryItems] = react.useState([])
        const [historyStatus, setHistoryStatus] = react.useState('')
        const [health, setHealth] = react.useState(null)
        const [healthBusy, setHealthBusy] = react.useState(false)
        /* 向导：只问四件事，走完写 onboarded */
        const [wizardStep, setWizardStep] = react.useState(0)
        const [memories, setMemories] = react.useState(null)
        const [memText, setMemText] = react.useState('')
        const [memSlot, setMemSlot] = react.useState('event')
        const [memBusy, setMemBusy] = react.useState('')
        const [memStatus, setMemStatus] = react.useState('')
        const [companion, setCompanion] = react.useState(null)
        const [companionError, setCompanionError] = react.useState('')
        const [ability, setAbility] = react.useState(null)
        const [abilityBusy, setAbilityBusy] = react.useState('')
        const [abilityStatus, setAbilityStatus] = react.useState('')
        const [lastRound, setLastRound] = react.useState(null)
        const [allSessions, setAllSessions] = react.useState([])
        const [sessionsStatus, setSessionsStatus] = react.useState('')
        const [sessionBusy, setSessionBusy] = react.useState('')
        const [preview, setPreview] = react.useState(null)
        const [previewStatus, setPreviewStatus] = react.useState('')
        const [backupPassphrase, setBackupPassphrase] = react.useState('')
        const [backupEncrypted, setBackupEncrypted] = react.useState(true)
        const [backupBusy, setBackupBusy] = react.useState('')
        const [backupStatus, setBackupStatus] = react.useState('')
        const [vision, setVision] = react.useState({
          seeded: false,
          enabled: false,
          baseUrl: '',
          model: '',
          apiKey: '',
        })
        const [visionBusy, setVisionBusy] = react.useState('')
        const [visionStatus, setVisionStatus] = react.useState('')
        const [peerText, setPeerText] = react.useState({ owner: '', important: '', secondary: '' })
        const [peerBusy, setPeerBusy] = react.useState('')
        const [peerStatus, setPeerStatus] = react.useState('')
        /* QQ 语音：触发词和开关都只在这一格，叫名字的唤醒词留在别处。 */
        const [qqVoiceText, setQqVoiceText] = react.useState('发句语音')
        const [qqVoiceBusy, setQqVoiceBusy] = react.useState('')
        const [qqVoiceStatus, setQqVoiceStatus] = react.useState('')
        /* 游戏感知：只读状态，不启动游戏；gameInfo 为空表示还没读或读失败。 */
        const [gameInfo, setGameInfo] = react.useState(null)
        const [gameBusy, setGameBusy] = react.useState('')
        const [gameStatus, setGameStatus] = react.useState('')
        /* 陪看：地址、要说的话、正在做什么，都只留在这一页。 */
        const [watchUrl, setWatchUrl] = react.useState(
          () => (typeof state?.watch?.defaultUrl === 'string' ? state.watch.defaultUrl : ''),
        )
        const [watchSay, setWatchSay] = react.useState('')
        const [watchBusy, setWatchBusy] = react.useState('')
        const [watchStatus, setWatchStatus] = react.useState('')

        const load = react.useCallback(() => {
          api(STATE_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              const next = payload.value ?? {}
              setState(next)
              /* 触发词留空时后端回落到「发句语音」，输入框里也照这个显示。 */
              if (typeof next.qqVoiceWakeWord === 'string' && next.qqVoiceWakeWord.trim() !== '') {
                setQqVoiceText(next.qqVoiceWakeWord)
              }
            })
            .catch((error) => {
              log('warn', '读取桌宠状态失败', error)
              setStatus('读取失败了… 宿主半可能没加载。')
              setTone('err')
            })
        }, [])

        const loadMemories = react.useCallback(() => {
          api(MEMORY_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setMemories(Array.isArray(payload.items) ? payload.items : [])
            })
            .catch((error) => {
              log('warn', '读取记忆失败', error)
              setMemories([])
              setMemStatus('记忆列表没读出来…')
            })
        }, [])

        const loadCompanion = react.useCallback(() => {
          api(COMPANION_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setCompanion(payload)
              setCompanionError('')
            })
            .catch((error) => {
              log('warn', '读取陪伴状态失败', error)
              setCompanion(null)
              setCompanionError('陪伴状态没读出来…')
            })
        }, [])

        const loadAbility = react.useCallback(() => {
          api(ABILITY_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setAbility(payload)
              if (payload.round) setLastRound(payload.round)
            })
            .catch((error) => {
              log('warn', '读取战绩失败', error)
              setAbility(null)
              setAbilityStatus('战绩没读出来…')
            })
        }, [])

        /* 游戏状态：一次读进程表 + 两个可选工具；失败只影响这一页。 */
        const loadGames = react.useCallback((force) => {
          setGameBusy('load')
          api(`${GAMES_PATH}${force === true ? '?refresh=1' : ''}`, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setGameInfo(payload.value ?? null)
              setGameStatus('')
            })
            .catch((error) => {
              log('warn', '读取游戏状态失败', error)
              setGameInfo(null)
              setGameStatus('游戏状态没读出来…')
            })
            .then(() => setGameBusy(''))
        }, [])

        /* 打开桌宠自己的游戏页：插件只写一个请求位，窗口由桌宠主进程开。 */
        const openGamePage = react.useCallback(() => {
          setGameBusy('open')
          setGameStatus('正在叫桌宠把游戏页打开…')
          api('/cyrene-pet/games/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setGameStatus('已经请她开游戏页了，没弹出来就看看桌宠还开着吗…')
            })
            .catch((error) => {
              log('warn', '打开游戏页失败', error)
              setGameStatus('没能叫醒桌宠，游戏页得在桌宠那边手动开…')
            })
            .then(() => setGameBusy(''))
        }, [])

        /* 陪看：把地址交给桌宠开一个只停在 B 站的窗口。插件自己不开窗。 */
        const openWatch = react.useCallback(() => {
          const target = watchUrl.trim()
          if (target === '') {
            setWatchStatus('先贴一个 B 站链接，或者 BV 号。')
            return
          }
          setWatchBusy('open')
          setWatchStatus('正在叫她把窗打开…')
          api('/cyrene-pet/watch/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: target }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                const message = payload?.error?.message
                throw new Error(typeof message === 'string' ? message : 'bad payload')
              }
              setWatchStatus('开好了，去屏幕上找那个 B 站窗吧♪')
            })
            .catch((error) => {
              log('warn', '打开陪看窗失败', error)
              const message = String(error?.message ?? '')
              setWatchStatus(
                message.includes('只认') || message.includes('B 站')
                  ? message
                  : '没能开成，看看桌宠还开着吗…',
              )
            })
            .then(() => setWatchBusy(''))
        }, [watchUrl])

        const closeWatch = react.useCallback(() => {
          setWatchBusy('close')
          api('/cyrene-pet/watch/close', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then(() => setWatchStatus('窗收起来了。'))
            .catch((error) => {
              log('warn', '关闭陪看窗失败', error)
              setWatchStatus('关不掉，手动把那个窗关一下吧。')
            })
            .then(() => setWatchBusy(''))
        }, [])

        /* 让她在桌面弹幕里说一句；只排队，不触发模型。 */
        const sayDanmaku = react.useCallback(() => {
          const text = watchSay.trim()
          if (text === '') return
          setWatchBusy('say')
          api('/cyrene-pet/watch/danmaku', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setWatchSay('')
              setWatchStatus('说出去了，从屏幕右边飘过来…')
            })
            .catch((error) => {
              log('warn', '推弹幕失败', error)
              setWatchStatus('这句没送出去，再试一次？')
            })
            .then(() => setWatchBusy(''))
        }, [watchSay])

        const loadSessions = react.useCallback(() => {          api(SESSIONS_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              const workspaces = Array.isArray(payload.value?.workspaces) ? payload.value.workspaces : []
              const flat = []
              for (const workspace of workspaces) {
                const sessions = Array.isArray(workspace?.sessions) ? workspace.sessions : []
                for (const item of sessions) {
                  if (!item || typeof item.id !== 'string') continue
                  flat.push({ ...item, workspaceName: workspace.name ?? item.workspace ?? '' })
                }
              }
              flat.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
              setAllSessions(flat)
              setSessionsStatus('')
            })
            .catch((error) => {
              log('warn', '读取会话列表失败', error)
              setAllSessions([])
              setSessionsStatus('会话列表没读出来…')
            })
        }, [])

        /* 名单按行编辑：一行一个键，比让人手写 JSON 好记。逗号和分号也当分隔。 */
        const joinLines = (list) => (Array.isArray(list) ? list.join('\n') : '')
        const splitLines = (text) =>
          String(text ?? '')
            .split(/[\n,，;；]+/)
            .map((item) => item.trim())
            .filter((item) => item !== '')

        const loadPeers = react.useCallback(() => {
          api(PEERS_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              const tiers = payload.peers ?? {}
              setPeerText({
                owner: joinLines(tiers.owner),
                important: joinLines(tiers.important),
                secondary: joinLines(tiers.secondary),
              })
              setPeerStatus('')
            })
            .catch((error) => {
              log('warn', '同伴名单没读出来', error)
              setPeerStatus('名单没读出来…')
            })
        }, [])

        const savePeers = () => {
          if (peerBusy !== '') return
          setPeerBusy('save')
          setPeerStatus('正在保存…')
          api(PEERS_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              owner: splitLines(peerText.owner),
              important: splitLines(peerText.important),
              secondary: splitLines(peerText.secondary),
            }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              /* 后端存的就是刚提交的这三组，不用再读一遍；留着输入框原样，方便接着改。 */
              setPeerStatus('名单已保存，下一条消息就按新关系算 ♪')
            })
            .catch((error) => {
              log('warn', '同伴名单没存上', error)
              setPeerStatus('没保存成功… 键要写成 qq:private:<openid> 这种样子')
            })
            .finally(() => setPeerBusy(''))
        }

        /* QQ 语音这一格只发三样设置；后端没给 rev 就不带，省得撞版本号。 */
        const saveQqVoice = (patchBody) => {
          if (qqVoiceBusy !== '') return
          setQqVoiceBusy('save')
          setQqVoiceStatus('正在保存…')
          const body = { ...patchBody }
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          api(STATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setQqVoiceStatus('已保存 ♪')
              load()
            })
            .catch((error) => {
              log('warn', 'QQ 语音设置没存上', error)
              setQqVoiceStatus('没保存成功…')
            })
            .finally(() => setQqVoiceBusy(''))
        }

        const bindSession = (id, label) => {
          setSessionBusy(id === '' ? 'follow' : id)
          setSessionsStatus(id === '' ? '正在回到跟随当前对话…' : `正在切到「${label}」…`)
          api(SESSION_BIND_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setState((current) => (current === null ? current : { ...current, boundSessionId: id === '' ? null : id }))
              setPreview(null)
              setPreviewStatus('')
              setSessionsStatus(id === '' ? '现在跟着当前对话走 ♪' : `已经切到「${label}」♪`)
              loadSessions()
              loadCompanion()
            })
            .catch((error) => {
              log('warn', '切换会话失败', error)
              setSessionsStatus('这条会话没切过去…')
            })
            .then(() => setSessionBusy(''))
        }

        const openSession = (id) => {
          setPreviewStatus('正在翻这十条…')
          setPreview(null)
          api(`${SESSION_HISTORY_PATH}?id=${encodeURIComponent(id)}&limit=10`, {
            headers: { accept: 'application/json' },
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setPreview(payload.value)
            })
            .catch((error) => {
              log('warn', '读取会话片段失败', error)
              setPreviewStatus('这段没翻开…')
            })
            .then(() => {
              setPreviewStatus((current) => (current === '正在翻这十条…' ? '' : current))
            })
        }

        react.useEffect(() => {
          load()
          loadCompanion()
          loadAbility()
          loadSessions()
          loadMemories()
          loadPeers()
          loadGames()
        }, [load, loadCompanion, loadAbility, loadSessions, loadMemories, loadPeers, loadGames])

        const memoryAction = (path, body, label, clearText = false) => {
          setMemBusy(label)
          setMemStatus(`${label}…`)
          api(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setMemStatus(`${label}好了 ♪`)
              if (clearText) setMemText('')
              loadMemories()
            })
            .catch((error) => {
              log('warn', `记忆${label}失败`, error)
              setMemStatus(`${label}没有成功…`)
            })
            .then(() => setMemBusy(''))
        }

        /* 自定义表情包：和内置共用一份清单，上传、批量导入、改名、删除都走同一套。 */
        const [customStickers, setCustomStickers] = react.useState(null)
        const [stickerBusy, setStickerBusy] = react.useState('')
        const [stickerStatus, setStickerStatus] = react.useState('')
        const stickerBatchRef = react.useRef(null)

        const loadCustomStickers = react.useCallback(() => {
          api(`${STICKER_CUSTOM_PATH}?t=${Date.now()}`, {
            headers: { accept: 'application/json' },
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              setCustomStickers(Array.isArray(payload.value) ? payload.value : [])
            })
            .catch((error) => {
              log('warn', '读取表情包库失败', error)
              setCustomStickers([])
              setStickerStatus('表情包库没读出来…')
            })
        }, [])

        react.useEffect(() => {
          loadCustomStickers()
        }, [loadCustomStickers])

        /* 单张图读成 dataUrl 交给宿主半；返回是否收下。 */
        const sendStickerFile = (file) =>
          new Promise((resolve) => {
            if (file.size > 8 * 1024 * 1024) {
              resolve(false)
              return
            }
            const reader = new FileReader()
            reader.onload = () => {
              api(`${STICKER_CUSTOM_PATH}/upload`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ dataUrl: String(reader.result ?? ''), name: file.name }),
              })
                .then((payload) => {
                  if (!payload || payload.ok !== true) throw new Error('failed')
                  resolve(true)
                })
                .catch((error) => {
                  log('warn', '上传表情失败', error)
                  resolve(false)
                })
            }
            reader.onerror = () => resolve(false)
            reader.readAsDataURL(file)
          })

        /* 一次选一批：群里存下来的表情常常是几十张，逐个传，失败的跳过。 */
        const uploadStickers = (fileList) => {
          const files = Array.from(fileList ?? []).filter((file) =>
            String(file.type).startsWith('image/'),
          )
          if (files.length === 0) {
            setStickerStatus('这些都不是图片…')
            return
          }
          setStickerBusy('上传中…')
          setStickerStatus('')
          Promise.all(files.map((file) => sendStickerFile(file)))
            .then((results) => {
              const ok = results.filter((hit) => hit === true).length
              const skipped = files.length - ok
              setStickerStatus(
                ok === 0
                  ? '一张都没收下…可能太大了或者格式不支持。'
                  : `收好了 ${ok} 张${skipped > 0 ? `，跳过 ${skipped} 张` : ''}。`,
              )
              loadCustomStickers()
            })
            .finally(() => setStickerBusy(''))
        }

        const renameSticker = (item) => {
          const next = window.prompt('换个名字（标签也跟着换）', item.name)
          if (next === null) return
          const trimmed = next.trim()
          if (trimmed === '' || trimmed === item.name) return
          setStickerBusy(item.id)
          api(`${STICKER_CUSTOM_PATH}/rename`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id, name: trimmed }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              setStickerStatus('改好了。')
              loadCustomStickers()
            })
            .catch((error) => {
              log('warn', '表情改名失败', error)
              setStickerStatus('没改成…')
            })
            .then(() => setStickerBusy(''))
        }

        const deleteSticker = (item) => {
          if (!window.confirm(`要删掉「${item.label || item.name}」吗？`)) return
          setStickerBusy(item.id)
          api(`${STICKER_CUSTOM_PATH}/delete`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              setStickerStatus('删掉了。')
              loadCustomStickers()
            })
            .catch((error) => {
              log('warn', '删除表情失败', error)
              setStickerStatus('没删掉…')
            })
            .then(() => setStickerBusy(''))
        }

        const importRef = react.useRef(null)

        /* ---------------- 聊天页外观：背景图 + 模糊 ---------------- */

        const [chatLook, setChatLook] = react.useState({ items: [], active: null, appearance: null, slotNames: [] })
        const [lookBlur, setLookBlur] = react.useState(0)
        /* 正在调哪一处：页面 / 桌宠窗口 / 设置卡片 / 设置窗口。四槽各存各的，选一个只管一个。 */
        const [lookSlot, setLookSlot] = react.useState('page')
        /* 取景锚点：0~100 的百分比，和 background-position 一一对应 */
        const [lookPos, setLookPos] = react.useState({ x: 50, y: 50 })
        const [lookZoom, setLookZoom] = react.useState(1)
        const [lookDim, setLookDim] = react.useState(0.35)
        const [lookBusy, setLookBusy] = react.useState('')
        const [lookStatus, setLookStatus] = react.useState('')
        const bgFileRef = react.useRef(null)

        const bgSlotNames = Array.isArray(chatLook.slotNames) && chatLook.slotNames.length > 0
          ? chatLook.slotNames
          : ['page', 'window', 'settingsCard', 'settingsWindow']
        const bgSlots = chatLook.active?.slots !== null && typeof chatLook.active?.slots === 'object'
          ? chatLook.active.slots
          : {}
        const slotNow = bgSlots[lookSlot] !== null && typeof bgSlots[lookSlot] === 'object'
          ? bgSlots[lookSlot]
          : { id: '', dim: 0.35, posX: 50, posY: 50, zoom: 1 }
        const slotLabel = (name) => ({
          page: 'DSH 页面',
          window: '桌宠窗口',
          settingsCard: '设置卡片',
          settingsWindow: '设置窗口',
        })[name] ?? name
        const usedSlotCount = Object.values(bgSlots).filter((item) => (item?.id ?? '') !== '').length
        /* 滚轮缩放是连着滚的，等手停下来再落盘，别每滚一格发一次请求 */
        const zoomTimerRef = react.useRef(null)

        const loadChatLook = () => {
          api(`${BACKGROUNDS_PATH}?t=${Date.now()}`)
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              setChatLook({
                items: Array.isArray(payload.items) ? payload.items : [],
                active: payload.active ?? null,
                appearance: payload.appearance ?? null,
                slotNames: Array.isArray(payload.slotNames) ? payload.slotNames : [],
              })
            })
            .catch((error) => log('warn', '读聊天页外观失败', error))
        }

        react.useEffect(() => {
          if (state === null) return
          loadChatLook()
        }, [state?.rev])

        react.useEffect(() => {
          const blur = Number(chatLook.appearance?.bgBlur)
          if (Number.isFinite(blur)) setLookBlur(blur)
        }, [chatLook.appearance?.bgBlur])

        /* 换到另一处时，把那一处自己记住的取景读回控件；这一处的值不带到别处去。 */
        react.useEffect(() => {
          const x = Number(slotNow.posX)
          const y = Number(slotNow.posY)
          const zoom = Number(slotNow.zoom)
          const dim = Number(slotNow.dim)
          if (Number.isFinite(x) && Number.isFinite(y)) setLookPos({ x, y })
          if (Number.isFinite(zoom)) setLookZoom(Math.min(3, Math.max(1, zoom)))
          if (Number.isFinite(dim)) setLookDim(Math.min(0.85, Math.max(0, dim)))
        }, [lookSlot, slotNow.id, slotNow.posX, slotNow.posY, slotNow.zoom, slotNow.dim])

        /* 拖动时先只管画面，松手再写进设置，不用每动一格都发一次请求。 */
        const previewBlur = (value) => {
          setLookBlur(value)
          const id = slotNow.id ?? ''
          if (id !== '') {
            paintBgNow(id, value, { posX: lookPos.x, posY: lookPos.y, zoom: lookZoom, dim: lookDim })
          }
        }

        /* 取景器拖动 / 缩放：只动画面，不写设置；改的若不是 page 槽，本页也不用跟着变 */
        const previewSlot = (patch) => {
          const nextPos = {
            x: patch.posX ?? lookPos.x,
            y: patch.posY ?? lookPos.y,
          }
          const nextZoom = patch.zoom ?? lookZoom
          const nextDim = patch.dim ?? lookDim
          setLookPos(nextPos)
          if (patch.zoom !== undefined) setLookZoom(nextZoom)
          if (patch.dim !== undefined) setLookDim(nextDim)
          const id = slotNow.id ?? ''
          if (id !== '' && lookSlot === 'page') {
            paintBgNow(id, lookBlur, {
              posX: nextPos.x,
              posY: nextPos.y,
              zoom: nextZoom,
              dim: nextDim,
            })
          }
        }

        /* 写回：只提交当前这一槽，另外三处一个字都不动 */
        const saveSlot = (patch, label) => {
          const body = {}
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          body.background = { slots: { [lookSlot]: patch } }
          setLookBusy('save')
          setLookStatus(label ?? '正在记住…')
          api(STATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                throw new Error(payload?.error?.message ?? 'failed')
              }
              setState(payload.value ?? {})
              loadChatLook()
              setLookStatus('记下了 ♪')
            })
            .catch((error) => {
              log('warn', '保存背景设置失败', error)
              setLookStatus('没记住，再试一次')
            })
            .then(() => setLookBusy(''))
        }

        /* 九宫格：点一下先换预览，松手落盘 */
        const saveLookPos = (pos) => {
          previewSlot({ posX: pos.x, posY: pos.y })
          saveSlot({ posX: Math.round(pos.x), posY: Math.round(pos.y) }, '正在记住这个取景…')
        }

        const saveLookBlur = (value) => {
          const body = {}
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          body.appearance = {
            skin: state?.appearance?.skin === 'off' ? 'off' : 'on',
            palette: state?.appearance?.palette ?? 'sakura',
            bgBlur: Math.min(Math.max(Number(value) || 0, 0), 24),
          }
          setLookBusy('save')
          setLookStatus('正在记住这个模糊度…')
          api(STATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                throw new Error(payload?.error?.message ?? 'failed')
              }
              setState(payload.value ?? {})
              setLookStatus('记下了 ♪')
            })
            .catch((error) => {
              log('warn', '保存背景模糊失败', error)
              setLookStatus('没有记住，再拖一次试试')
            })
            .then(() => setLookBusy(''))
        }

        const savePalette = (next) => {
          const body = {}
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          body.appearance = {
            skin: state?.appearance?.skin === 'off' ? 'off' : 'on',
            palette: next,
            bgBlur: Math.min(Math.max(Number(state?.appearance?.bgBlur) || 0, 0), 24),
          }
          setLookBusy('save')
          setLookStatus('正在换配色…')
          api(STATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                throw new Error(payload?.error?.message ?? 'failed')
              }
              setState(payload.value ?? {})
              /* 皮肤层在另一个 effect 里，喊一声让它重读，页面不用刷新 */
              try {
                window.dispatchEvent(new Event(`${PACKAGE_ID}:appearance`))
              } catch { /* 没有 window 事件环境就算了 */ }
              setLookStatus('换好啦 ♪')
            })
            .catch((error) => {
              log('warn', '保存配色失败', error)
              setLookStatus('没换成…')
            })
            .then(() => setLookBusy(''))
        }

        /* 立刻把这一张铺到本页，用在「拖取景」「换图」这种要马上看到效果的场合。
           传进来的 pose 是 { posX, posY, zoom, dim }，四项都能缺。 */
        const paintBgNow = (id, blur, pose) => {
          const page = document.documentElement
          const px = Number.isFinite(Number(pose?.posX)) ? Number(pose.posX) : 50
          const py = Number.isFinite(Number(pose?.posY)) ? Number(pose.posY) : 50
          const zoom = Number.isFinite(Number(pose?.zoom)) ? Math.min(3, Math.max(1, Number(pose.zoom))) : 1
          const dim = Number.isFinite(Number(pose?.dim)) ? Math.min(0.85, Math.max(0, Number(pose.dim))) : 0.35
          page.style.setProperty('--cyp-bg-pos', `${Math.min(100, Math.max(0, px))}% ${Math.min(100, Math.max(0, py))}%`)
          page.style.setProperty('--cyp-dim', String(dim))
          if (id === '') {
            page.removeAttribute('data-pet-bg')
            page.style.removeProperty('--cyp-bg-url')
            page.style.removeProperty('--cyp-bg-size')
            return
          }
          const fallback = `${BACKGROUND_PATH}/${encodeURIComponent(id)}`
          composeBgUrl(id, blur)
            .catch((error) => {
              log('warn', '背景模糊合成失败，先铺原图', error)
              return fallback
            })
            .then((url) => {
              page.style.setProperty('--cyp-bg-url', `url("${url}")`)
              page.setAttribute('data-pet-bg', 'on')
              const probe = new Image()
              probe.onload = () => {
                page.style.setProperty('--cyp-bg-size', bgCoverSize(
                  zoom, probe.naturalWidth, probe.naturalHeight, window.innerWidth, window.innerHeight))
              }
              probe.onerror = () => page.style.setProperty('--cyp-bg-size', 'cover')
              probe.src = url
            })
        }

        /* 收一张图进库，并直接挂到当前这一处；slot 一起发过去，后端只写这一个槽。 */
        const uploadChatBg = (files) => {
          const file = files?.[0]
          if (!file) return
          if (file.size > 8 * 1024 * 1024) {
            setLookStatus('这张太大了，8MB 以内才行')
            return
          }
          setLookBusy('上传中')
          setLookStatus('正在收进图库…')
          const reader = new FileReader()
          reader.onload = () => {
            api(BACKGROUNDS_PATH, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dataUrl: String(reader.result ?? ''), slot: lookSlot }),
            })
              .then((payload) => {
                if (!payload || payload.ok !== true) {
                  throw new Error(payload?.error?.message ?? 'failed')
                }
                if (lookSlot === 'page') {
                  paintBgNow(String(payload.item?.id ?? ''), lookBlur, {
                    posX: lookPos.x,
                    posY: lookPos.y,
                    zoom: lookZoom,
                    dim: lookDim,
                  })
                }
                loadChatLook()
                setLookStatus('换好啦 ♪')
              })
              .catch((error) => {
                log('warn', '上传背景失败', error)
                setLookStatus(error?.message ?? '没有铺上去…')
              })
              .then(() => setLookBusy(''))
          }
          reader.onerror = () => {
            setLookBusy('')
            setLookStatus('这张图读不出来…')
          }
          reader.readAsDataURL(file)
        }

        /* 从库里挑一张，挂到当前这一处。同一张图可以被几处同时用。 */
        const useChatBg = (id) => {
          if (lookSlot === 'page') {
            paintBgNow(id, lookBlur, {
              posX: lookPos.x,
              posY: lookPos.y,
              zoom: lookZoom,
              dim: lookDim,
            })
          }
          saveSlot({ id }, '正在换这张…')
        }

        /* 「这一处不要了」和「把图从库里删掉」是两件事：这里只解绑，文件留着。 */
        const clearSlot = () => {
          if ((slotNow.id ?? '') === '') {
            setLookStatus('这一处还没有图')
            return
          }
          if (lookSlot === 'page') paintBgNow('', lookBlur, null)
          saveSlot({ id: '' }, '正在收起…')
        }

        /* 从库里彻底删掉：后端会把引用它的槽位一起清空，不会留下坏引用。 */
        const deleteFromLibrary = (id) => {
          if (id === '') return
          setLookBusy('删除中')
          setLookStatus('正在从库里删掉…')
          api(`${BACKGROUNDS_PATH}/remove`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              const nextSlots = payload?.active?.slots ?? {}
              const stillUsed = Object.values(nextSlots).some((item) => item?.id === id)
              if (!stillUsed && (slotNow.id ?? '') === id && lookSlot === 'page') {
                paintBgNow('', lookBlur, null)
              }
              loadChatLook()
              setLookStatus('删掉了')
            })
            .catch((error) => {
              log('warn', '删除背景失败', error)
              setLookStatus('没有删掉…')
            })
            .then(() => setLookBusy(''))
        }

        /* 第一次读到设置时把表单填上；之后用户改到一半也不会被刷新覆盖。 */
        react.useEffect(() => {
          if (state === null) return
          setVision((prev) => {
            if (prev.seeded === true) return prev
            return {
              seeded: true,
              enabled: state.vision?.enabled === true,
              baseUrl: state.vision?.baseUrl ?? '',
              model: state.vision?.model ?? '',
              apiKey: '',
            }
          })
        }, [state])

        const saveVision = (clearApiKey = false) => {
          const body = {}
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          body.vision = {
            enabled: vision.enabled === true,
            baseUrl: vision.baseUrl.trim(),
            model: vision.model.trim(),
            apiKey: vision.apiKey.trim(),
          }
          if (clearApiKey === true) body.vision.clearApiKey = true
          setVisionBusy('save')
          setVisionStatus('正在保存视觉标签设置…')
          api(STATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                if (payload?.value) setState(payload.value)
                const error = new Error(payload?.error?.message ?? 'failed')
                error.code = payload?.error?.code ?? ''
                throw error
              }
              setState(payload.value ?? {})
              setVision((prev) => ({ ...prev, apiKey: '', seeded: true }))
              setVisionStatus(clearApiKey === true ? 'Key 已经清掉了' : '已经保存 ♪')
            })
            .catch((error) => {
              log('warn', '保存视觉标签设置失败', error)
              setVisionStatus(
                error?.code === 'stale' ? '设置在别处更新过了，已经刷新，再试一次' : '没有保存成功…',
              )
            })
            .then(() => setVisionBusy(''))
        }

        const testVision = () => {
          setVisionBusy('test')
          setVisionStatus('正在连一下视觉模型…')
          api(VISION_TEST_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then((payload) => {
              setVisionStatus(
                payload?.ok === true ? '连上了，能看图 ♪' : (payload?.error?.message ?? '没有连上…'),
              )
            })
            .catch((error) => {
              log('warn', '视觉模型探活失败', error)
              setVisionStatus('没有连上…')
            })
            .then(() => setVisionBusy(''))
        }

        const saveMemorySettings = (patch, label) => {
          const body = {}
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          if (typeof patch.memoryEnabled === 'boolean') body.enabled = patch.memoryEnabled
          if (typeof patch.memoryNoticeDismissed === 'boolean') {
            body.noticeDismissed = patch.memoryNoticeDismissed
          }
          setBusy('state')
          setStatus(`${label}…`)
          api(MEMORY_SETTINGS_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                /* 409 会把最新状态一起带回来：先接住，用户再点一次就能用新 rev 保存 */
                if (payload?.value) setState(payload.value)
                const error = new Error(payload?.error?.message ?? 'failed')
                error.code = payload?.error?.code ?? ''
                throw error
              }
              setState(payload.value ?? {})
              setStatus(`${label}好了 ♪`)
              setTone('')
            })
            .catch((error) => {
              log('warn', `设置${label}失败`, error)
              setStatus(error?.code === 'stale' ? '设置在别处更新过了，已经刷新，请再试一次' : `${label}没有成功…`)
              setTone('err')
            })
            .then(() => setBusy(''))
        }

        const exportMemory = () => {
          setMemBusy('导出')
          setMemStatus('正在把她的记忆装进信封…')
          api(MEMORY_EXPORT_PATH, { headers: { accept: 'application/json' } })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('bad payload')
              const text = JSON.stringify(payload, null, 2)
              const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = `cyrene-memory-${new Date().toISOString().slice(0, 10)}.json`
              link.click()
              URL.revokeObjectURL(url)
              setMemStatus('备份已经导出 ✉')
            })
            .catch((error) => {
              log('warn', '导出记忆失败', error)
              setMemStatus('备份没有导出成功…')
            })
            .then(() => setMemBusy(''))
        }

        const importMemory = (event) => {
          const file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          file.text()
            .then((text) => {
              const parsed = JSON.parse(text)
              memoryAction(MEMORY_IMPORT_PATH, { memory: parsed.memory ?? parsed }, '恢复')
            })
            .catch((error) => {
              log('warn', '读取记忆备份失败', error)
              setMemStatus('这份备份读不出来…')
            })
        }

        const backupFileRef = react.useRef(null)

        const exportFullBackup = () => {
          if (backupEncrypted && backupPassphrase.trim().length < 8) {
            setBackupStatus('加密备份的口令至少需要 8 个字符')
            return
          }
          setBackupBusy('export')
          setBackupStatus('正在把整库装进备份…')
          api(BACKUP_EXPORT_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              encrypted: backupEncrypted,
              passphrase: backupPassphrase,
            }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              const text = JSON.stringify(payload.backup, null, 2)
              const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = payload.fileName || 'cyrene-pet-backup.json'
              link.click()
              URL.revokeObjectURL(url)
              setBackupStatus(backupEncrypted ? '加密备份已经导出 ✉' : '明文备份已经导出（请妥善保管）')
            })
            .catch((error) => {
              log('warn', '导出整库备份失败', error)
              setBackupStatus(`备份没有导出成功：${error?.message ?? '未知错误'}`)
            })
            .then(() => setBackupBusy(''))
        }

        const restoreFullBackup = (event) => {
          const file = event.target.files && event.target.files[0]
          event.target.value = ''
          if (!file) return
          file.text()
            .then((text) => {
              const parsed = JSON.parse(text)
              const encrypted = parsed && parsed.format === 'cyrene-pet-backup-envelope'
              if (encrypted && backupPassphrase.trim().length < 8) {
                throw new Error('这份备份需要口令，先在输入框里填好再恢复')
              }
              if (!window.confirm('恢复会覆盖当前的设置、记忆、好感和陪伴状态，确定继续吗？')) {
                return null
              }
              setBackupBusy('restore')
              setBackupStatus('正在恢复整库…')
              return api(BACKUP_RESTORE_PATH, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  backup: parsed,
                  passphrase: encrypted ? backupPassphrase : '',
                }),
              })
            })
            .then((payload) => {
              if (payload === null) return
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setBackupStatus(`恢复好了，记忆 ${Number(payload.memoryCount) || 0} 条 ♪`)
              load()
              loadCompanion()
              loadMemories()
            })
            .catch((error) => {
              log('warn', '恢复整库备份失败', error)
              setBackupStatus(`没有恢复成功：${error?.message ?? '未知错误'}`)
            })
            .then(() => setBackupBusy(''))
        }

        const rotateVaultKeys = () => {
          if (!window.confirm('轮换后会重新加密本机的密钥仓库与记忆仓库，确定继续吗？')) return
          setBackupBusy('rotate')
          setBackupStatus('正在轮换本机密钥…')
          api(VAULT_ROTATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setBackupStatus('本机密钥已经轮换 ♪')
            })
            .catch((error) => {
              log('warn', '轮换本机密钥失败', error)
              setBackupStatus(`轮换没有成功：${error?.message ?? '未知错误'}`)
            })
            .then(() => setBackupBusy(''))
        }

        const playAbility = (choice) => {
          setAbilityBusy(choice)
          setAbilityStatus('')
          api(ABILITY_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ choice }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setAbility(payload)
              setLastRound(payload.round ?? null)
            })
            .catch((error) => {
              log('warn', '出拳失败', error)
              setAbilityStatus('这一局没结算成功…')
            })
            .then(() => setAbilityBusy(''))
        }

        const whenText = (value) => {
          const stamp = Number(value)
          if (!Number.isFinite(stamp) || stamp <= 0) return ''
          const date = new Date(stamp)
          if (Number.isNaN(date.getTime())) return ''
          return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })
        }

        const roleLabel = (role) => {
          if (role === 'user') return '你'
          if (role === 'assistant') return '她'
          return '记录'
        }

        const sessionLabel = (item) => {
          const title = typeof item?.title === 'string' ? item.title.trim() : ''
          if (title !== '') return title
          const workspace = typeof item?.workspaceName === 'string' ? item.workspaceName.trim() : ''
          return workspace === '' ? '未命名对话' : `${workspace} · 未命名对话`
        }

        const control = (action, label) => {
          setBusy(action)
          setStatus(`${label}…`)
          setTone('')
          api(CONTROL_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action }),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error(payload?.error?.message ?? 'failed')
              setState(payload.value ?? {})
              setBusy('')
              setStatus(
                action === 'start' ? '已经去叫桌宠起床了，稍等两秒 ♪' : action === 'restart' ? '重新拉起来了，等它露个脸 ♪' : '先把桌宠收起来了。',
              )
              setTone('')
            })
            .catch((error) => {
              log('warn', `桌宠${label}失败`, error)
              setBusy('')
              setStatus(`${label}没有成功… 看看宿主日志？`)
              setTone('err')
            })
        }

        if (state === null) {
          return h('div', { className: 'cyp-card' },
            h('p', { className: 'cyp-hint' }, '正在看看桌宠醒着没有…'))
        }

        const running = state.petRunning === true
        const runtimeError = typeof state.runtimeError === 'string' ? state.runtimeError : ''

        /* ---------------- 设置控件工厂 ----------------
           一页只放两三组，所以每个可调项都做成独立一行：
           左边名字、右边控件、下面一句说明。所有值都直接写到 /state，
           后端 normalize 是白名单合并，提交单个字段不会冲掉别的。 */
        /* 进体检页 / 改动页时才拉数据，其他页不打扰后端 */
        react.useEffect(() => {
          if (tab === 'health') loadHealth()
          if (tab === 'history') loadHistory()
        }, [tab])

        const panelStyle = (id) => ({ display: tab === id ? undefined : 'none' })

        const patchState = (partial, label) => {
          const body = { ...partial }
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          setBusy('state')
          setStatus(`${label}…`)
          setTone('')
          api(STATE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                /* 409 会把最新状态带回来：先接住，用户再点一次就能用新 rev 保存 */
                if (payload?.value) setState(payload.value)
                const error = new Error(payload?.error?.message ?? 'failed')
                error.code = payload?.error?.code ?? ''
                throw error
              }
              setState(payload.value ?? {})
              setStatus(`${label}已保存 ♪`)
            })
            .catch((error) => {
              log('warn', `保存${label}失败`, error)
              setStatus(error?.code === 'stale' ? '设置刚在别处更新过，已经刷新，再点一次' : `${label}没保存成功…`)
              setTone('err')
            })
            .then(() => setBusy(''))
        }

        /* 最近改动：进页时拉一次，回退后再拉一次 */
        const loadHistory = () => {
          api(`${SETTINGS_HISTORY_PATH}?t=${Date.now()}`)
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              setHistoryItems(Array.isArray(payload.items) ? payload.items : [])
              setHistoryStatus('')
            })
            .catch((error) => {
              setHistoryItems([])
              setHistoryStatus('读不到改动记录…')
              log('warn', '读最近改动失败', error)
            })
        }

        /* 单条回退：把这一条之前的写前值放回去，别的项不动 */
        const undoChange = (item) => {
          const body = { id: item.id }
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          setHistoryStatus('正在回退…')
          api(SETTINGS_UNDO_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                if (payload?.value) setState(payload.value)
                const error = new Error(payload?.error?.message ?? 'failed')
                error.code = payload?.error?.code ?? ''
                throw error
              }
              setState(payload.value ?? {})
              setHistoryStatus('已经退回这一步 ♪')
              loadHistory()
            })
            .catch((error) => {
              log('warn', '回退设置失败', error)
              setHistoryStatus(error?.code === 'stale' ? '设置刚在别处改过，已经刷新，再点一次' : '这一次没能回退…')
            })
        }

        /* 体检四灯：只读，不改任何设置 */
        const loadHealth = () => {
          setHealthBusy(true)
          api(`${HEALTH_PATH}?t=${Date.now()}`)
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              setHealth(payload.value ?? null)
            })
            .catch((error) => {
              setHealth(null)
              log('warn', '体检失败', error)
            })
            .then(() => setHealthBusy(false))
        }

        /* 向导走完：写 onboarded，之后不再自动弹 */
        const finishWizard = () => {
          const body = { done: true }
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          api(WIZARD_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) throw new Error('failed')
              setState(payload.value ?? {})
            })
            .catch((error) => log('warn', '向导标记失败', error))
        }

        /* 单项恢复默认：把 path 交给后端，默认值以后端 DEFAULTS 为准，
           前端不存第二份默认值，避免两边慢慢走散。 */
        const resetField = (key, label) => {
          if (!key) return
          const body = { path: key }
          if (Number.isFinite(state?.rev)) body.rev = state.rev
          setBusy('state')
          setStatus(`${label}恢复默认…`)
          setTone('')
          api(SETTINGS_RESET_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then((payload) => {
              if (!payload || payload.ok !== true) {
                if (payload?.value) setState(payload.value)
                const error = new Error(payload?.error?.message ?? 'failed')
                error.code = payload?.error?.code ?? ''
                throw error
              }
              setState(payload.value ?? {})
              setStatus(`${label}已恢复默认 ♪`)
            })
            .catch((error) => {
              log('warn', `恢复${label}失败`, error)
              setStatus(error?.code === 'stale' ? '设置刚在别处更新过，已经刷新，再点一次' : `${label}没能恢复默认…`)
              setTone('err')
            })
            .then(() => setBusy(''))
        }

        const resetButton = (key, label) => (key
          ? h('button', {
              type: 'button',
              className: 'cyp-reset',
              title: `${label}恢复默认`,
              'aria-label': `${label}恢复默认`,
              onClick: () => resetField(key, label),
            }, '↺')
          : null)

        /* 设置搜索：按可见文字和字段名跨页过滤，清空就恢复原样。 */
        const filterSettings = (input) => {
          const card = input.closest('.cyp-card')
          if (!card) return
          const panes = card.querySelector('.cyp-panes')
          const query = input.value.trim().toLowerCase()
          const sets = card.querySelectorAll('.cyp-set')
          if (query === '') {
            if (panes) panes.removeAttribute('data-searching')
            sets.forEach((node) => {
              delete node.dataset.miss
              delete node.dataset.hit
            })
            return
          }
          if (panes) panes.setAttribute('data-searching', '1')
          sets.forEach((node) => {
            const label = node.dataset.label ?? ''
            const key = node.dataset.field ?? ''
            const text = node.textContent ?? ''
            if (`${label} ${key} ${text}`.toLowerCase().includes(query)) {
              node.dataset.hit = '1'
              delete node.dataset.miss
            } else {
              node.dataset.miss = '1'
              delete node.dataset.hit
            }
          })
        }

        const patchAppearance = (patch, label) => patchState({
          appearance: {
            skin: state?.appearance?.skin === 'off' ? 'off' : 'on',
            palette: state?.appearance?.palette ?? 'sakura',
            bgBlur: Math.min(Math.max(Number(state?.appearance?.bgBlur) || 0, 0), 24),
            ...patch,
          },
        }, label)

        const patchBackground = (patch, label) => patchState({
          background: {
            id: state?.background?.id ?? '',
            dim: Number.isFinite(Number(state?.background?.dim)) ? Number(state.background.dim) : 0.35,
            rotateMinutes: Number(state?.background?.rotateMinutes) || 0,
            posX: Number.isFinite(Number(state?.background?.posX)) ? Number(state.background.posX) : 50,
            posY: Number.isFinite(Number(state?.background?.posY)) ? Number(state.background.posY) : 50,
            targets: {
              page: state?.background?.targets?.page !== false,
              window: state?.background?.targets?.window !== false,
            },
            windowBlur: Math.min(24, Math.max(0, Math.round(Number(state?.background?.windowBlur) || 0))),
            ...patch,
          },
        }, label)

        const patchIntimacy = (patch, label) => patchState({
          intimacy: {
            enabled: state?.intimacy?.enabled === true,
            perDay: Number(state?.intimacy?.perDay) || 1,
            cooldownHours: Number(state?.intimacy?.cooldownHours) || 6,
            idleHours: Number(state?.intimacy?.idleHours) || 6,
            aftercareMinutes: Number(state?.intimacy?.aftercareMinutes) || 30,
            ...patch,
          },
        }, label)

        const patchAxes = (key, patch, label) => {
          const base = state?.companionAxes ?? {}
          const next = {}
          for (const axis of ['relation', 'friction', 'body', 'memory', 'proactive']) {
            const current = base[axis] ?? {}
            next[axis] = {
              enabled: current.enabled !== false,
              sensitivity: ['low', 'normal', 'high'].includes(current.sensitivity) ? current.sensitivity : 'normal',
            }
          }
          next[key] = { ...next[key], ...patch }
          patchState({ companionAxes: next }, label)
        }

        const patchPersona = (patch, label) => patchState({
          persona: {
            enabled: typeof patch.enabled === 'boolean'
              ? patch.enabled
              : (state?.persona?.enabled !== false),
            sections: { ...(state?.persona?.sections ?? {}), ...(patch.sections ?? {}) },
            extraPrompt: typeof patch.extraPrompt === 'string'
              ? patch.extraPrompt
              : (state?.persona?.extraPrompt ?? ''),
          },
        }, label)

        const patchQq = (patch, label) => patchState({
          qq: {
            enabled: state?.qq?.enabled === true,
            privacyMode: state?.qq?.privacyMode !== false,
            appId: typeof state?.qq?.appId === 'string' ? state.qq.appId : '',
            ownerOpenIds: Array.isArray(state?.qq?.ownerOpenIds) ? state.qq.ownerOpenIds : [],
            ...patch,
          },
        }, label)

        const setHint = (text) => (text ? h('span', { className: 'cyp-set-sub' }, text) : null)

        const setArea = (label, value, onCommit, hint, rows = 3) =>
          h('div', { className: 'cyp-set' },
            h('span', { className: 'cyp-set-label' }, label),
            h('textarea', {
              className: 'cyp-input',
              rows,
              defaultValue: value,
              onBlur: (event) => {
                const next = event.currentTarget.value
                if (next !== value) onCommit(next)
              },
            }),
            setHint(hint))
        const setToggle = (label, key, hint, invert = false) => {
          const on = invert ? state[key] === false : state[key] !== false
          return h('div', { className: 'cyp-set', 'data-field': key, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                resetButton(key, label),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': on ? '1' : '0',
                  'aria-pressed': on ? 'true' : 'false',
                  onClick: () => patchState({ [key]: invert ? on : !on }, label),
                }))),
            setHint(hint))
        }

        const setSeg = (label, key, options, hint, build) => {
          const current = String(state[key] ?? '')
          return h('div', { className: 'cyp-set', 'data-field': key, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              resetButton(key, label)),
            h('div', { className: 'cyp-seg' },
              options.map(([id, text]) => h('button', {
                key: id,
                type: 'button',
                className: 'cyp-seg-btn',
                'data-on': current === id ? '1' : '0',
                onClick: () => (build ? build(id) : patchState({ [key]: id }, label)),
              }, text))),
            setHint(hint))
        }

        const setRange = (label, key, min, max, step, hint, format, build) => {
          const fmt = format ?? ((value) => String(value))
          const value = Number(state[key])
          return h('div', { className: 'cyp-set', 'data-field': key, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                h('span', { className: 'cyp-num', 'data-out': key }, fmt(Number.isFinite(value) ? value : min)),
                resetButton(key, label))),
            h('input', {
              type: 'range',
              className: 'cyp-range',
              min,
              max,
              step,
              defaultValue: Number.isFinite(value) ? value : min,
              onChange: (event) => {
                const out = event.currentTarget.parentElement?.querySelector(`[data-out="${key}"]`)
                if (out) out.textContent = fmt(Number(event.currentTarget.value))
              },
              onMouseUp: (event) => {
                const next = Number(event.currentTarget.value)
                if (build) build(next)
                else patchState({ [key]: next }, label)
              },
              onTouchEnd: (event) => {
                const next = Number(event.currentTarget.value)
                if (build) build(next)
                else patchState({ [key]: next }, label)
              },
            }),
            setHint(hint))
        }

        const setText = (label, key, placeholder, hint, maxLength) =>
          h('div', { className: 'cyp-set', 'data-field': key, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              resetButton(key, label)),
            h('input', {
              type: 'text',
              className: 'cyp-input',
              defaultValue: String(state[key] ?? ''),
              placeholder: placeholder ?? '',
              maxLength: maxLength ?? 200,
              onBlur: (event) => {
                const next = event.currentTarget.value
                if (next !== String(state[key] ?? '')) patchState({ [key]: next }, label)
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              },
            }),
            setHint(hint))

        const setNumber = (label, key, min, max, step, hint, build) =>
          h('div', { className: 'cyp-set', 'data-field': key, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              resetButton(key, label)),
            h('input', {
              type: 'number',
              className: 'cyp-input',
              defaultValue: Number(state[key]) || 0,
              min,
              max,
              step,
              onBlur: (event) => {
                const next = Number(event.currentTarget.value)
                if (!Number.isFinite(next) || next === Number(state[key])) return
                if (build) build(next)
                else patchState({ [key]: next }, label)
              },
            }),
            setHint(hint))

        /* ---------------- 游戏页控件 ----------------
           game 是嵌套对象，setToggle 那套只认顶层键，所以这里单独写一小组：
           每次提交都带上整份 game，避免只发一个键把别的冲掉。 */
        const gameState = state?.game && typeof state.game === 'object' ? state.game : {}
        const patchGame = (patch, label) => patchState({ game: { ...gameState, ...patch } }, label)

        const gameToggle = (label, key, hint) => {
          const on = gameState[key] !== false
          return h('div', { className: 'cyp-set', 'data-field': `game.${key}`, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                resetButton(`game.${key}`, label),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': on ? '1' : '0',
                  'aria-pressed': on ? 'true' : 'false',
                  onClick: () => patchGame({ [key]: !on }, label),
                }))),
            setHint(hint))
        }

        const gameRange = (label, key, min, max, step, hint, format) => {
          const fmt = format ?? ((value) => String(value))
          const value = Number(gameState[key])
          const current = Number.isFinite(value) ? value : min
          return h('div', { className: 'cyp-set', 'data-field': `game.${key}`, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                h('span', { className: 'cyp-num', 'data-out': `game.${key}` }, fmt(current)),
                resetButton(`game.${key}`, label))),
            h('input', {
              type: 'range',
              className: 'cyp-range',
              min,
              max,
              step,
              defaultValue: current,
              onChange: (event) => {
                const out = event.currentTarget.parentElement?.querySelector(`[data-out="game.${key}"]`)
                if (out) out.textContent = fmt(Number(event.currentTarget.value))
              },
              onMouseUp: (event) => patchGame({ [key]: Number(event.currentTarget.value) }, label),
              onTouchEnd: (event) => patchGame({ [key]: Number(event.currentTarget.value) }, label),
            }),
            setHint(hint))
        }

        const gameText = (label, key, placeholder, hint, maxLength) =>
          h('div', { className: 'cyp-set', 'data-field': `game.${key}`, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              resetButton(`game.${key}`, label)),
            h('input', {
              type: 'text',
              className: 'cyp-input',
              defaultValue: typeof gameState[key] === 'string' ? gameState[key] : '',
              placeholder,
              maxLength,
              onBlur: (event) => {
                const next = event.currentTarget.value.trim()
                if (next === (typeof gameState[key] === 'string' ? gameState[key] : '')) return
                patchGame({ [key]: next }, label)
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              },
            }),
            setHint(hint))

        /* 陪看 / 弹幕：和 game 一样是嵌套对象，整份提交，别把兄弟字段冲掉。 */
        const watchState = state?.watch && typeof state.watch === 'object' ? state.watch : {}
        const patchWatch = (patch, label) => patchState({ watch: { ...watchState, ...patch } }, label)
        const danmakuState = state?.danmaku && typeof state.danmaku === 'object' ? state.danmaku : {}
        const patchDanmaku = (patch, label) => patchState({ danmaku: { ...danmakuState, ...patch } }, label)

        const watchToggle = (label, key, hint) => {
          const on = watchState[key] !== false
          return h('div', { className: 'cyp-set', 'data-field': `watch.${key}`, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                resetButton(`watch.${key}`, label),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': on ? '1' : '0',
                  'aria-pressed': on ? 'true' : 'false',
                  onClick: () => patchWatch({ [key]: !on }, label),
                }))),
            setHint(hint))
        }

        const danmakuToggle = (label, key, hint) => {
          const on = danmakuState[key] !== false
          return h('div', { className: 'cyp-set', 'data-field': `danmaku.${key}`, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                resetButton(`danmaku.${key}`, label),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': on ? '1' : '0',
                  'aria-pressed': on ? 'true' : 'false',
                  onClick: () => patchDanmaku({ [key]: !on }, label),
                }))),
            setHint(hint))
        }

        const danmakuRange = (label, key, min, max, step, hint, format) => {
          const fmt = format ?? ((value) => String(value))
          const raw = Number(danmakuState[key])
          const current = Number.isFinite(raw) ? raw : min
          return h('div', { className: 'cyp-set', 'data-field': `danmaku.${key}`, 'data-label': label },
            h('div', { className: 'cyp-set-head' },
              h('span', { className: 'cyp-set-label' }, label),
              h('span', { className: 'cyp-set-tools' },
                h('span', { className: 'cyp-num', 'data-out': `danmaku.${key}` }, fmt(current)),
                resetButton(`danmaku.${key}`, label))),
            h('input', {
              type: 'range',
              className: 'cyp-range',
              min,
              max,
              step,
              defaultValue: current,
              onChange: (event) => {
                const out = event.currentTarget.parentElement?.querySelector(`[data-out="danmaku.${key}"]`)
                if (out) out.textContent = fmt(Number(event.currentTarget.value))
              },
              onMouseUp: (event) => patchDanmaku({ [key]: Number(event.currentTarget.value) }, label),
              onTouchEnd: (event) => patchDanmaku({ [key]: Number(event.currentTarget.value) }, label),
            }),
            setHint(hint))
        }

        /* 页内小节：把「游戏 / 陪看 / 弹幕」放进同一页时，用标题分段，不堆平铺开关。 */
        /* 背景素材只存一份，四个位置各自决定用哪张、怎么取景。 */

        const sectionTitle = (text, hint) =>
          h('div', { className: 'cyp-sec-title' },
            h('span', { className: 'cyp-sec-name' }, text),
            hint ? h('span', { className: 'cyp-sec-hint' }, hint) : null)

        const TABS = [
          ['overview', '概览'],
          ['basic', '基本'],
          ['persona', '人格'],
          ['figure', '形象'],
          ['bubble', '气泡'],
          ['theme', '外观'],
          ['gallery', '图库'],
          ['sticker', '表情'],
          ['vision', '识别'],
          ['bond', '好感'],
          ['peers', '联系人'],
          ['intimacy', '亲密'],
          ['memory', '记忆'],
          ['voice', '语音'],
          ['qq', 'QQ'],
          ['session', '会话'],
          ['game', '游戏 · 陪看'],
          ['rps', '小游戏'],
          ['data', '数据'],
        ]

        /* 六组导航：左栏只列六件事，页签收在组内。
           图库 / 表情 / 会话 / 记忆是「看内容」的，放系统组末尾，不跟开关抢位置。 */
        const NAV_GROUPS = [
          ['self', '她是谁', ['basic', 'persona']],
          ['look', '她的样子', ['figure', 'theme', 'gallery', 'sticker']],
          ['ability', '她的能力', ['voice', 'vision', 'game', 'rps']],
          ['memory', '她的记忆', ['memory', 'session', 'data']],
          ['talk', '她怎么说话', ['bubble']],
          ['outside', '她和外面', ['qq']],
          ['active', '她什么时候主动', ['bond', 'intimacy', 'peers']],
          ['system', '系统', ['overview', 'history', 'health']],
        ]
        const TAB_LABELS = Object.fromEntries(TABS)
        TAB_LABELS.history = '最近改动'
        TAB_LABELS.health = '体检'
        const groupTabs = (NAV_GROUPS.find(([id]) => id === group) ?? NAV_GROUPS[0])[2]
        /* 每页的生效方式：只要有一位要重启，整页就提示重启，别让人改完等不到反应 */
        const RESTART_PANELS = new Set(['basic', 'figure'])
        const effectHint = (id) => (RESTART_PANELS.has(id) ? '改完要重启桌宠才生效' : '改完立刻生效')
        /* 体检的每盏灯落到哪一页；组跟着页面走，免得页签和内容对不上 */
        const HEALTH_TAB = { reply: 'data', voice: 'voice', appear: 'figure', qq: 'qq' }
        const groupOfTab = (id) => (NAV_GROUPS.find(([, , ids]) => ids.includes(id)) ?? NAV_GROUPS[0])[0]
        const shortValue = (value) => {
          if (value === null || value === undefined) return '（空）'
          if (typeof value === 'string') {
            if (value === '') return '（空）'
            return value.length > 18 ? `${value.slice(0, 18)}…` : value
          }
          return String(value)
        }
        const historySource = (source) => {
          const text = String(source ?? '')
          if (text === 'settings') return '设置写入'
          if (text === 'wizard') return '向导'
          if (text.startsWith('reset:')) return `恢复默认 · ${text.slice(6)}`
          if (text.startsWith('undo:')) return '回退操作'
          return text
        }

        return h('div', { className: 'cyp-card', 'data-tab': tab },
          h('div', { className: 'cyp-head' },
            h('div', { className: 'cyp-title' },
              '昔涟 · 桌宠',
              state.version ? h('span', { className: 'cyp-version' }, `v${state.version}`) : null),
            h('div', { className: 'cyp-hint' },
              '所有选项改完立刻生效；分成多页，一页只放一件事。')),
          /* 向导：只问四件事，其余 27 项留在设置里慢慢看 */
          state.onboarded === false
            ? h('div', { className: 'cyp-wizard' },
                h('div', { className: 'cyp-wizard-head' },
                  h('span', { className: 'cyp-wizard-step' }, wizardStep < 4 ? `第 ${wizardStep + 1} / 4 步` : '最后一步'),
                  h('button', {
                    type: 'button',
                    className: 'cyp-reset',
                    onClick: () => finishWizard(),
                  }, '以后再说')),
                wizardStep === 0
                  ? h('div', { className: 'cyp-wizard-body' },
                      h('div', { className: 'cyp-set-label' }, '怎么称呼你'),
                      h('input', {
                        className: 'cyp-input',
                        defaultValue: state.nickname ?? '',
                        placeholder: '比如「旅者」',
                        onBlur: (event) => patchState({ nickname: event.currentTarget.value.trim() }, '称呼'),
                      }),
                      h('div', { className: 'cyp-set-hint' }, '填完点下一步；以后在「她是谁」里还能改。'))
                  : wizardStep === 1
                    ? h('div', { className: 'cyp-wizard-body' },
                        h('div', { className: 'cyp-set-label' }, '她以什么形态出现'),
                        h('div', { className: 'cyp-row' },
                          h('button', {
                            type: 'button',
                            className: 'cyp-btn',
                            'data-tone': (state.ui ?? 'pet') === 'pet' ? 'primary' : undefined,
                            onClick: () => patchState({ ui: 'pet' }, '形态'),
                          }, '立绘'),
                          h('button', {
                            type: 'button',
                            className: 'cyp-btn',
                            'data-tone': state.ui === 'card' ? 'primary' : undefined,
                            onClick: () => patchState({ ui: 'card' }, '形态'),
                          }, '卡片')),
                        h('div', { className: 'cyp-set-hint' }, '素材包不在的时候会自己退回卡片，不会留一片白。'))
                    : wizardStep === 2
                      ? h('div', { className: 'cyp-wizard-body' },
                          h('div', { className: 'cyp-set-label' }, '要不要出声'),
                          h('div', { className: 'cyp-row' },
                            h('button', {
                              type: 'button',
                              className: 'cyp-btn',
                              'data-tone': state.speechEnabled === true ? 'primary' : undefined,
                              onClick: () => patchState({ speechEnabled: true }, '念出声'),
                            }, '要'),
                            h('button', {
                              type: 'button',
                              className: 'cyp-btn',
                              'data-tone': state.speechEnabled !== true ? 'primary' : undefined,
                              onClick: () => patchState({ speechEnabled: false }, '念出声'),
                            }, '不要')),
                          state.speechEnabled === true
                            ? h('input', {
                                className: 'cyp-input',
                                defaultValue: state.ttsEndpoint ?? '',
                                placeholder: 'TTS 地址，例如 http://127.0.0.1:9880；留空就用系统语音',
                                onBlur: (event) => patchState({ ttsEndpoint: event.currentTarget.value.trim() }, 'TTS 地址'),
                              })
                            : null,
                          h('div', { className: 'cyp-set-hint' }, '不要就把整块藏起来；要了也可以先留空走系统语音。'))
                      : wizardStep === 3
                        ? h('div', { className: 'cyp-wizard-body' },
                            h('div', { className: 'cyp-set-label' }, '要不要接 QQ'),
                            h('div', { className: 'cyp-row' },
                              h('button', {
                                type: 'button',
                                className: 'cyp-btn',
                                'data-tone': state.qq?.enabled === true ? 'primary' : undefined,
                                onClick: () => patchState({ qq: { enabled: true } }, 'QQ 通道'),
                              }, '要'),
                              h('button', {
                                type: 'button',
                                className: 'cyp-btn',
                                'data-tone': state.qq?.enabled !== true ? 'primary' : undefined,
                                onClick: () => patchState({ qq: { enabled: false } }, 'QQ 通道'),
                              }, '不要')),
                            h('div', { className: 'cyp-set-hint' }, '不要就直接跳过；AppID 与 Secret 以后在「她和外面」填。'))
                        : h('div', { className: 'cyp-wizard-body' },
                            h('div', { className: 'cyp-set-label' }, '自检'),
                            health === null
                              ? h('div', { className: 'cyp-note' }, healthBusy ? '正在看…' : '还没跑')
                              : h('div', { className: 'cyp-list' }, health.items.map((item) => h('div', {
                                  key: item.id,
                                  className: 'cyp-hist',
                                },
                                h('div', { className: 'cyp-hist-head' },
                                  h('i', { className: 'cyp-light', 'data-on': item.ok ? '1' : '0' }),
                                  h('span', { className: 'cyp-hist-src' }, item.label),
                                  h('span', { className: 'cyp-hist-time' }, item.ok ? '绿' : '红')),
                                h('div', { className: 'cyp-hist-body' }, item.ok ? item.detail : item.fix))))),
                h('div', { className: 'cyp-row' },
                  wizardStep > 0
                    ? h('button', {
                        type: 'button',
                        className: 'cyp-btn',
                        onClick: () => setWizardStep(wizardStep - 1),
                      }, '上一步')
                    : null,
                  wizardStep < 4
                    ? h('button', {
                        type: 'button',
                        className: 'cyp-btn',
                        'data-tone': 'primary',
                        onClick: () => {
                          if (wizardStep === 3) loadHealth()
                          setWizardStep(wizardStep + 1)
                        },
                      }, wizardStep === 3 ? '跑自检' : '下一步')
                    : h('button', {
                        type: 'button',
                        className: 'cyp-btn',
                        'data-tone': 'primary',
                        onClick: () => finishWizard(),
                      }, '完成')))
            : null,
          h('div', { className: 'cyp-search' },
            h('input', {
              type: 'search',
              className: 'cyp-search-input',
              placeholder: '找一项设置，比如「气泡」「音色」「额度」',
              'aria-label': '搜索设置项',
              onInput: (event) => filterSettings(event.currentTarget),
            })),
          /* 六组：一行按钮，取代原来十八个平铺页签 */
          h('nav', { className: 'cyp-groups', role: 'tablist', 'aria-label': '设置分组' },
            NAV_GROUPS.map(([id, label, ids]) => h('button', {
              key: id,
              type: 'button',
              role: 'tab',
              className: 'cyp-group',
              'data-active': group === id ? '1' : '0',
              'aria-selected': group === id ? 'true' : 'false',
              onClick: () => {
                setGroup(id)
                setTab(ids[0])
              },
            }, label))),
          h('div', { className: 'cyp-body' },
          h('nav', { className: 'cyp-tabs', role: 'tablist', 'aria-label': '当前分组下的页面' },
            groupTabs.map((id) => h('button', {
              key: id,
              type: 'button',
              role: 'tab',
              className: 'cyp-tab',
              'data-active': tab === id ? '1' : '0',
              'aria-selected': tab === id ? 'true' : 'false',
              onClick: () => setTab(id),
            }, TAB_LABELS[id] ?? id))),
          /* 改完到底什么时候生效，先说在前面，省得反复猜 */
          h('div', {
            className: 'cyp-effect',
            'data-restart': RESTART_PANELS.has(tab) ? '1' : '0',
          }, effectHint(tab)),
          h('div', { className: 'cyp-panes' },
          /* 体检：四盏灯只报事实，红的点一下就跳到对应那一项 */
          h('div', { className: 'cyp-panel', 'data-panel': 'health', style: panelStyle('health') },
            h('div', { className: 'cyp-sec-title' }, '体检',
              h('span', { className: 'cyp-sec-hint' }, '她回话吗 / 她出声吗 / 她出现吗 / QQ 通吗')),
            health === null
              ? h('div', { className: 'cyp-note' }, healthBusy ? '正在看…' : '还没拿到结果，点下面「重新体检」')
              : health.items.map((item) => h('div', {
                  key: item.id,
                  className: 'cyp-set',
                  'data-health': item.ok ? 'ok' : 'bad',
                },
                h('div', { className: 'cyp-set-head' },
                  h('i', { className: 'cyp-light', 'data-on': item.ok ? '1' : '0' }),
                  h('span', { className: 'cyp-set-label' }, item.label),
                  h('span', { className: 'cyp-set-hint' }, item.detail)),
                h('div', { className: 'cyp-set-foot' },
                  h('span', { className: 'cyp-set-hint' }, item.fix),
                  h('button', {
                    type: 'button',
                    className: 'cyp-btn',
                    onClick: () => {
                      const next = HEALTH_TAB[item.id] ?? 'basic'
                      setGroup(groupOfTab(next))
                      setTab(next)
                    },
                  }, '去这一项')))),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                disabled: healthBusy,
                onClick: loadHealth,
              }, healthBusy ? '体检中…' : '重新体检'))),

          /* 最近改动：最近 10 次写入，单条可退，别的项不动 */
          h('div', { className: 'cyp-panel', 'data-panel': 'history', style: panelStyle('history') },
            h('div', { className: 'cyp-sec-title' }, '最近改动',
              h('span', { className: 'cyp-sec-hint' }, '留最近 10 次写入；退回只动那一条改过的项')),
            historyStatus === '' ? null : h('div', { className: 'cyp-note' }, historyStatus),
            historyItems.length === 0
              ? h('div', { className: 'cyp-note' }, '还没有改动记录。改一项设置就会出现在这里。')
              : h('div', { className: 'cyp-list' }, historyItems.map((item) => h('div', {
                  key: item.id,
                  className: 'cyp-hist',
                },
                h('div', { className: 'cyp-hist-head' },
                  h('span', { className: 'cyp-hist-time' }, new Date(item.at).toLocaleString('zh-CN', { hour12: false })),
                  h('span', { className: 'cyp-hist-src' }, historySource(item.source)),
                  h('button', {
                    type: 'button',
                    className: 'cyp-btn',
                    onClick: () => undoChange(item),
                  }, '退回这一步')),
                h('div', { className: 'cyp-hist-body' }, item.changes.map((change, index) => h('div', {
                  key: `${item.id}-${index}`,
                  className: 'cyp-hist-item',
                },
                h('code', null, change.label ?? change.path),
                ' ',
                h('span', null, `${shortValue(change.before)} → ${shortValue(change.after)}`))))))),
            h('div', { className: 'cyp-row' },
              h('button', { type: 'button', className: 'cyp-btn', onClick: loadHistory }, '刷新'))),

          h('div', { className: 'cyp-panel', 'data-panel': 'overview', style: panelStyle('overview') },
          h('div', { className: 'cyp-state' },
            h('i', {
              className: 'cyp-dot',
              'data-on': running ? '1' : '0',
              'data-err': runtimeError !== '' ? '1' : '0',
            }),
            h('span', null,
              running ? '桌宠正在运行' : state.enabled === false ? '桌宠已关闭' : '桌宠没有在运行')),
          runtimeError === ''
            ? null
            : h('div', { className: 'cyp-note' }, `最近一次启动失败：${runtimeError}`),
          h('div', { className: 'cyp-row' },
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              'data-tone': 'primary',
              disabled: busy !== '' || running,
              onClick: () => control('start', '启动'),
            }, '启动'),
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              disabled: busy !== '',
              onClick: () => control('restart', '重启'),
            }, '重启'),
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              disabled: busy !== '' || !running,
              onClick: () => control('stop', '关闭'),
            }, '关闭'),
            h('button', {
              type: 'button',
              className: 'cyp-btn',
              disabled: busy !== '',
              onClick: load,
            }, '刷新')),
          h('p', { className: 'cyp-note' },
            '提问与审批走 DSH 自身的权限与确认流程；长按立绘会播报当前任务进程。'),
          companion === null
            ? h('p', { className: 'cyp-hint' }, companionError || '正在看她今天的心情…')
            : h('div', { className: 'cyp-companion' },
                h('span', { className: 'cyp-chip' },
                  `关系 · ${companion.bond && companion.bond.levelLabel ? companion.bond.levelLabel : '还陌生'}`),
                h('span', { className: 'cyp-chip' },
                  `今天开口 ${Number(companion.openings && companion.openings.today) || 0} 次`),
                h('span', { className: 'cyp-chip' },
                  `记忆 ${Number(companion.memoryCount) || 0} 条`),
                companion.openings && companion.openings.gaveUp === true
                  ? h('span', { className: 'cyp-chip', 'data-tone': 'quiet' }, '先安静几天')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'cyp-mini',
                  onClick: loadCompanion,
                }, '刷新状态')),
          ),
          /* ---------------- 游戏 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'game', style: panelStyle('game') },
            h('p', { className: 'cyp-hint' },
              '这里只管两件事：看见你在玩，然后把自己收小一点。不启动游戏、不注入、不改档案。',
              '排班、真实执行和周常记录都在桌宠自己的游戏页里，点下面「打开游戏页」就能过去。'),
            h('div', { className: 'cyp-state' },
              h('i', {
                className: 'cyp-dot',
                'data-on': gameInfo && gameInfo.games && Array.isArray(gameInfo.games.running) && gameInfo.games.running.length > 0 ? '1' : '0',
                'data-err': gameStatus !== '' ? '1' : '0',
              }),
              h('span', null, gameBusy === 'load'
                ? '正在看进程表…'
                : gameInfo === null
                  ? (gameStatus || '还没读到游戏状态')
                  : gameInfo.enabled === false
                    ? '感知已关闭'
                    : gameInfo.games && gameInfo.games.ok === false
                      ? '进程表读不出来'
                      : gameInfo.games && Array.isArray(gameInfo.games.running) && gameInfo.games.running.length > 0
                        ? `正在玩：${gameInfo.games.running.map((item) => item.short).join('、')}`
                        : '没有检测到游戏在跑')),
            gameInfo && gameInfo.enabled !== false && gameInfo.games && Array.isArray(gameInfo.games.running) && gameInfo.games.running.length > 0
              ? h('div', { className: 'cyp-companion' },
                  gameInfo.games.running.map((item) =>
                    h('span', { key: item.id, className: 'cyp-chip' }, `${item.short} · ${item.process}`)))
              : null,
            h('div', { className: 'cyp-companion' },
              h('span', { className: 'cyp-chip' },
                gameInfo && gameInfo.launcher && gameInfo.launcher.ok
                  ? `启动器 · ${Array.isArray(gameInfo.launcher.running) ? gameInfo.launcher.running.length : 0} 个实例在跑`
                  : gameInfo && gameInfo.launcher && gameInfo.launcher.reason === 'not-configured'
                    ? '启动器 · 未配置'
                    : '启动器 · 没连上'),
              h('span', { className: 'cyp-chip' },
                gameInfo && gameInfo.m7a && gameInfo.m7a.ok
                  ? (gameInfo.m7a.running ? '小助手 · 正在跑任务' : '小助手 · 空闲')
                  : gameInfo && gameInfo.m7a && gameInfo.m7a.reason === 'not-configured'
                    ? '小助手 · 未配置'
                    : '小助手 · 没连上'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: gameBusy !== '',
                onClick: () => loadGames(true),
              }, '立即检查'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: gameBusy !== '',
                title: '游戏日常的排班和执行记录都在桌宠自己的游戏页里',
                onClick: () => openGamePage(),
              }, '打开游戏页')),
            sectionTitle('感知', '只看进程表，不启动、不注入、不改档案。'),
            gameToggle('感知游戏', 'enabled', '打开后设置页会读一次进程表；关掉后不再探测，也不进游戏模式。'),
            gameRange('检查间隔', 'pollSeconds', 5, 120, 5, '每隔多久看一次进程表，默认 15 秒。',
              (value) => `${Math.round(Number(value))} 秒`),
            sectionTitle('游戏时', '检测到游戏在跑，她把自己收小一点。'),
            gameToggle('自动进游戏模式', 'autoMode', '检测到游戏在跑时，桌宠自动降低存在感。'),
            gameToggle('游戏时收起气泡', 'hideBubble', '游戏模式下不弹气泡，避免挡住画面。'),
            gameRange('游戏时立绘不透明度', 'dimPet', 0.2, 1, 0.05, '游戏模式里立绘的不透明度；100% 表示和平时一样。',
              (value) => `${Math.round(Number(value) * 100)}%`),
            sectionTitle('外部工具', '两项都可选，留空就不读，不会去猜路径。'),
            gameText('dsh-launcher 地址', 'launcherUrl', 'http://127.0.0.1:9230', '只读它的 /state，用来知道哪个实例在跑。'),
            gameText('三月七小助手路径', 'm7aPath', 'D:\\March7thAssistant\\m7a.exe', '只跑 --status，不代跑任何任务。'),
            gameStatus !== '' ? h('p', { className: 'cyp-status' }, gameStatus) : null,
            sectionTitle('陪看', '开一个只留在 B 站的窗，插件不碰窗口本身。'),
            watchToggle('开启陪看', 'enabled', '关掉后「打开陪看」会被拒绝，已经开着的窗不受影响。'),
            h('div', { className: 'cyp-row' },
              h('input', {
                type: 'text',
                className: 'cyp-input',
                placeholder: 'BV1xx411c7mD、直播间号，或 https://www.bilibili.com/…',
                value: watchUrl,
                onChange: (event) => setWatchUrl(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') openWatch()
                },
              }),
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: watchBusy !== '',
                onClick: () => openWatch(),
              }, watchBusy === 'open' ? '正在开…' : '打开陪看'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: watchBusy !== '',
                onClick: () => closeWatch(),
              }, watchBusy === 'close' ? '收窗中…' : '关掉')),
            h('div', { className: 'cyp-row' },
              h('input', {
                type: 'text',
                className: 'cyp-input',
                placeholder: '让她现在飘一句…',
                maxLength: 120,
                value: watchSay,
                onChange: (event) => setWatchSay(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') sayDanmaku()
                },
              }),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: watchBusy !== '' || watchSay.trim() === '',
                onClick: () => sayDanmaku(),
              }, watchBusy === 'say' ? '…' : '飘一句')),
            sectionTitle('弹幕', '她想说话时，字从屏幕右边横着飘过去，不挡鼠标。'),
            danmakuToggle('开弹幕层', 'enabled', '关掉后她的话只在气泡里出现，不占整块屏幕。'),
            danmakuRange('字号', 'fontSize', 14, 40, 1, '全屏弹幕的字有多大。',
              (value) => `${Math.round(Number(value))} px`),
            danmakuRange('不透明度', 'opacity', 0.3, 1, 0.05, '调低会透出后面的画面，看片时更不打扰。',
              (value) => `${Math.round(Number(value) * 100)}%`),
            danmakuRange('飘过用时', 'seconds', 6, 30, 1, '一条字从右边走到左边要多久。',
              (value) => `${Math.round(Number(value))} 秒`),
            danmakuRange('轨道数', 'tracks', 3, 12, 1, '同时能排几行；多了更热闹，也更容易挡住内容。',
              (value) => `${Math.round(Number(value))} 行`),
            danmakuRange('静默收窗', 'idleMinutes', 1, 60, 1, '多久没说话就自己收起来。',
              (value) => `${Math.round(Number(value))} 分钟`),
            watchStatus === '' ? null : h('p', { className: 'cyp-status' }, watchStatus)),
          /* ---------------- 基本 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'basic', style: panelStyle('basic') },
            h('p', { className: 'cyp-hint' }, '桌宠开不开、她怎么叫你。'),
            setToggle('启用桌宠', 'enabled', '关掉后桌宠窗口不再出现，DSH 里的提问仍走网页卡片。'),
            setText('怎么称呼你', 'nickname', '旅者', '她会用这个名字和你说话，最长 24 字。', 24),
          ),
          /* ---------------- 窗口 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'basic', style: panelStyle('basic') },
            h('p', { className: 'cyp-hint' }, '桌宠以什么形态出现在屏幕上。'),
            setSeg('界面形态', 'ui', [['pet', '完整立绘'], ['card', '只要审批卡片']],
              '只留卡片时桌宠收成一个小方块，不想被挡住屏幕的时候用。'),
            setSeg('皮肤主题', 'theme', [['pink', '粉'], ['blue', '蓝'], ['ink', '墨']],
              '只管桌宠窗口的配色，和 DSH 设置页那套配色互相独立。'),
          ),
          /* ---------------- 人格·身份 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'persona', style: panelStyle('persona') },
            h('p', { className: 'cyp-hint' }, '七段都留空就回落到默认人格；填一段就整段替换，失焦即保存。'),
            h('div', { className: 'cyp-set' },
              h('div', { className: 'cyp-set-head' },
                h('span', { className: 'cyp-set-label' }, '启用自定义人格'),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': state?.persona?.enabled !== false ? '1' : '0',
                  onClick: () => patchPersona(
                    { enabled: state?.persona?.enabled === false },
                    '自定义人格',
                  ),
                })),
              setHint('关掉后只用内置人格，下面填的内容会留着但不生效。')),
            setArea('身份', state?.persona?.sections?.identity ?? '',
              (v) => patchPersona({ sections: { identity: v } }, '身份'), '她是谁，一句话立住的自我介绍。'),
            setArea('来历', state?.persona?.sections?.lore ?? '',
              (v) => patchPersona({ sections: { lore: v } }, '来历'), '她从哪儿来，经历过什么。'),
          ),
          /* ---------------- 人格·观念 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'persona', style: panelStyle('persona') },
            h('p', { className: 'cyp-hint' }, '她怎么理解世界、怎么过日常、什么不肯让步。'),
            setArea('世界观', state?.persona?.sections?.worldview ?? '',
              (v) => patchPersona({ sections: { worldview: v } }, '世界观'), '她怎么理解这个世界。'),
            setArea('生活观', state?.persona?.sections?.lifeview ?? '',
              (v) => patchPersona({ sections: { lifeview: v } }, '生活观'), '她怎么过日子、怎么看待日常。'),
            setArea('价值观', state?.persona?.sections?.values ?? '',
              (v) => patchPersona({ sections: { values: v } }, '价值观'), '什么对她重要，什么她不肯让步。'),
          ),
          /* ---------------- 人格·表达 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'persona', style: panelStyle('persona') },
            h('p', { className: 'cyp-hint' }, '动作、语气、自称；这三段最容易被听出来。'),
            setArea('举止', state?.persona?.sections?.manner ?? '',
              (v) => patchPersona({ sections: { manner: v } }, '举止'), '习惯动作、语气轻重、遇到事的反应。'),
            setArea('说话方式', state?.persona?.sections?.style ?? '',
              (v) => patchPersona({ sections: { style: v } }, '说话方式'), '自称、句尾、爱用的词。'),
            setArea('额外说明', state?.persona?.extraPrompt ?? '',
              (v) => patchPersona({ extraPrompt: v }, '额外说明'), '追加在七段之后，用来写临时要求。', 2),
          ),
          /* ---------------- 立绘 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'figure', style: panelStyle('figure') },
            h('p', { className: 'cyp-hint' }, '用哪套素材、以什么方式渲染。'),
            setSeg('渲染方式', 'renderer', [['sprite', '静态立绘'], ['live2d', 'Live2D']],
              'Live2D 需要自备模型，公开版不带。'),
            setText('素材包 ID', 'modelId', '留空用内置', '填素材包目录名，换一套立绘或模型。', 64),
          ),
          /* ---------------- 描边与尺寸 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'figure', style: panelStyle('figure') },
            h('p', { className: 'cyp-hint' }, '边缘怎么处理、多大、多久换姿势。'),
            setSeg('描边', 'outline', [['light', '白边'], ['dark', '深边'], ['auto', '按亮度'], ['none', '不加']],
              '立在深色背景上时，深边或按亮度会更清楚。'),
            setRange('缩放', 'scale', 0.6, 1.8, 0.05, '相对默认大小，0.6 到 1.8 倍。', (v) => `${v.toFixed(2)}×`),
            setRange('姿势轮换', 'poseSeconds', 0, 600, 10, '闲置多久换一次姿势；拖到 0 就不自动换。',
              (v) => (v === 0 ? '不换' : `${v} 秒`)),
            setText('模型提示', 'modelNotice', '可选', '显示在形象设置旁的一句说明，最长 200 字。'),
          ),
          /* ---------------- 气泡与状态条 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'bubble', style: panelStyle('bubble') },
            h('p', { className: 'cyp-hint' }, '头顶气泡和状态条怎么显示。'),
            setSeg('气泡内容', 'bubbleMode', [['rotate', '轮换'], ['info', '只看信息'], ['talk', '只看台词'], ['today', '只看今日额度']],
              '轮换会在余额信息和台词之间来回切。'),
            setRange('气泡字号', 'bubbleFont', 11, 20, 0.5, '气泡里字有多大。', (v) => `${v} px`),
            setRange('气泡宽度', 'bubbleWidth', 0, 600, 10, '气泡最多铺多宽；0 表示跟着窗口宽度走。', (v) => (Number(v) === 0 ? '跟随窗口' : `${v} px`)),
            setRange('气泡小表情', 'bubbleStickerSize', 24, 160, 4, '台词旁边那张小表情的边长。', (v) => `${v} px`),
            setRange('气泡圆角', 'bubbleRadius', 0, 18, 1, '0 是方角，18 接近胶囊。', (v) => `${v} px`),
            setRange('气泡不透明度', 'bubbleAlpha', 0.5, 1, 0.01, '调低会透出后面的画面。', (v) => `${Math.round(v * 100)}%`),
          ),
          /* ---------------- 状态条 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'bubble', style: panelStyle('bubble') },
            h('p', { className: 'cyp-hint' }, '立绘脚下那条信息条。'),
            setToggle('显示状态条', 'showHud', '关掉后只剩立绘和气泡。'),
            setSeg('状态条详细度', 'hudDetail', [['full', '完整'], ['simple', '精简'], ['simple2', '极简']],
              '只显示你最常看的那几项。'),
            setRange('状态条不透明度', 'hudAlpha', 0.4, 1, 0.01, '和气泡分开调。', (v) => `${Math.round(v * 100)}%`),
          ),
          /* ---------------- 提问设置 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'session', style: panelStyle('session') },
            h('p', { className: 'cyp-hint' }, '她多久问你一次、提问由谁接。'),
            setRange('提问间隔', 'askEveryMinutes', 0, 480, 5, '两次主动提问之间隔多久；0 表示不主动问。',
              (v) => (v === 0 ? '不问' : `${v} 分钟`)),
            setSeg('提问由谁接', 'askHandling',
              [['pet-all', '桌宠逐题'], ['pet-single', '只接单题'], ['both', '两边都问'], ['web', '只走网页卡片']],
              '两边都问时先答的那边算数。'),
          ),
          h('details', { className: 'cyp-sessions', 'data-panel': 'session', open: true, style: panelStyle('session') },
            h('summary', null,
              `会话绑定${allSessions.length > 0 ? `（${allSessions.length} 条可选）` : ''}`),
            h('p', { className: 'cyp-hint' },
              state.boundSessionId
                ? '已经选中一条会话；点「跟随当前对话」可以回到自动跟随。'
                : '现在跟着 DSH 的当前对话走。也可以选一条固定下来。'),
            sessionsStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, sessionsStatus),
            h('div', { className: 'cyp-session-list' },
              h('button', {
                type: 'button',
                className: 'cyp-session-item',
                'data-active': state.boundSessionId ? '0' : '1',
                disabled: sessionBusy !== '',
                onClick: () => bindSession('', ''),
              },
                h('span', { className: 'cyp-session-title' }, '跟随当前对话'),
                h('span', { className: 'cyp-session-time' }, '自动')),
              allSessions.length === 0
                ? h('p', { className: 'cyp-hint' }, '还没有能读到的会话。')
                : allSessions.slice(0, 20).map((item) =>
                    h('button', {
                      key: item.id,
                      type: 'button',
                      className: 'cyp-session-item',
                      'data-active': state.boundSessionId === item.id ? '1' : '0',
                      disabled: sessionBusy !== '',
                      onClick: () => {
                        bindSession(item.id, sessionLabel(item))
                        openSession(item.id)
                      },
                    },
                      h('span', { className: 'cyp-session-title' }, sessionLabel(item)),
                      item.running === true
                        ? h('span', { className: 'cyp-session-run' }, '生成中')
                        : null,
                      h('span', { className: 'cyp-session-time' }, whenText(item.updatedAt))))),
            previewStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, previewStatus),
            preview === null
              ? null
              : h('div', { className: 'cyp-preview' },
                  h('p', { className: 'cyp-hint' }, preview.title || '未命名会话'),
                  (Array.isArray(preview.messages) ? preview.messages : []).map((message, index) =>
                    h('p', {
                      key: `${preview.id ?? 'session'}-${index}`,
                      className: 'cyp-preview-item',
                      'data-role': message.role || 'other',
                    },
                      h('span', { className: 'cyp-preview-role' }, roleLabel(message.role)),
                      message.text
                        ? String(message.text).slice(0, 180)
                        : `[${message.kind || '记录'}]`)))),
          /* ---------------- 配色 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'theme', style: panelStyle('theme') },
            h('p', { className: 'cyp-hint' }, 'DSH 设置页自己的配色，和桌宠窗口分开。'),
            h('div', { className: 'cyp-set' },
              h('div', { className: 'cyp-set-head' },
                h('span', { className: 'cyp-set-label' }, '接管 DSH 配色'),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': state?.appearance?.skin !== 'off' ? '1' : '0',
                  onClick: () => patchAppearance(
                    { skin: state?.appearance?.skin === 'off' ? 'on' : 'off' },
                    '接管 DSH 配色',
                  ),
                })),
              setHint('关掉后 DSH 回到它自己的配色，桌宠窗口不受影响。')),
            h('div', { className: 'cyp-set' },
              h('span', { className: 'cyp-set-label' }, '配色主题'),
              h('div', { className: 'cyp-seg' },
                [['sakura', '樱粉'], ['plainpaper', '素纸'], ['celadon', '青瓷']].map(([id, text]) =>
                  h('button', {
                    key: id,
                    type: 'button',
                    className: 'cyp-seg-btn',
                    'data-on': (state?.appearance?.palette ?? 'sakura') === id ? '1' : '0',
                    onClick: () => patchAppearance({ palette: id }, '配色主题'),
                  }, text))),
              setHint('三套底色都只换颜色和边框，不改版式。')),
            h('div', { className: 'cyp-set' },
              h('div', { className: 'cyp-set-head' },
                h('span', { className: 'cyp-set-label' }, '背景模糊'),
                h('span', { className: 'cyp-num' }, `${Math.round(Number(state?.appearance?.bgBlur) || 0)} px`)),
              h('input', {
                type: 'range',
                className: 'cyp-range',
                min: 0,
                max: 24,
                step: 1,
                defaultValue: Number(state?.appearance?.bgBlur) || 0,
                onMouseUp: (event) => patchAppearance({ bgBlur: Number(event.currentTarget.value) }, '背景模糊'),
                onTouchEnd: (event) => patchAppearance({ bgBlur: Number(event.currentTarget.value) }, '背景模糊'),
              }),
              setHint('只影响 DSH 页面里铺的那张背景图。')),
          ),
          /* ---------------- 背景 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'theme', style: panelStyle('theme') },
            h('p', { className: 'cyp-hint' }, 'DSH 页面里铺的那张背景；具体用哪张在图库页挑。'),
            setRange('遮罩浓度', 'bgDim', 0, 1, 0.05, '数值越高，底图越淡、文字越清楚。',
              (v) => `${Math.round(v * 100)}%`,
              (v) => patchBackground({ slots: { page: { dim: v } } }, '遮罩浓度')),
            setRange('自动轮换', 'bgRotate', 0, 240, 5, '多久换一张图；0 表示不换。',
              (v) => (v === 0 ? '不换' : `${v} 分钟`),
              (v) => patchBackground({ rotateMinutes: v }, '自动轮换')),
          ),
          /* ---------------- 表情 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'sticker', style: panelStyle('sticker') },
            h('p', { className: 'cyp-hint' }, '聊天里能不能贴表情包；自己收的那一库在表情库页。'),
            setToggle('允许贴表情包', 'stickersEnabled', '关掉后人格附录里不再出现表情包那一段。'),
          ),
          /* ---------------- 好感 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'bond', style: panelStyle('bond') },
            h('p', { className: 'cyp-hint' }, '好感怎么涨、什么时候主动开口。'),
            setToggle('记录好感', 'bondEnabled', '关掉后关系等级停在原地，不再随相处变化。'),
            setToggle('允许主动开口', 'openingEnabled', '她会在你安静一会儿之后先说话；关掉就只在被叫时回应。'),
          ),
          /* ---------------- 感知五轴 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'bond', style: panelStyle('bond') },
            h('p', { className: 'cyp-hint' }, '开关决定她会不会被这件事影响，灵敏度决定留下多深的痕迹。'),
            [['relation', '关系感知', '谁会留在她心里，好感涨得快不快。'],
              ['friction', '摩擦感知', '被冷落、被顶撞时，她记多久。'],
              ['body', '身体感知', '累不累、冷不冷这类身体信号。'],
              ['memory', '记忆感知', '什么值得记下来，多久会淡。'],
              ['proactive', '主动感知', '该不该先开口，什么时候该安静。']].map(([key, label, hint]) => {
              const axis = state?.companionAxes?.[key] ?? {}
              return h('div', { className: 'cyp-set', key },
                h('div', { className: 'cyp-set-head' },
                  h('span', { className: 'cyp-set-label' }, label),
                  h('button', {
                    type: 'button',
                    className: 'cyp-switch',
                    'data-on': axis.enabled !== false ? '1' : '0',
                    onClick: () => patchAxes(key, { enabled: axis.enabled === false }, label),
                  })),
                h('div', { className: 'cyp-seg' },
                  [['low', '低'], ['normal', '正常'], ['high', '高']].map(([id, text]) =>
                    h('button', {
                      key: id,
                      type: 'button',
                      className: 'cyp-seg-btn',
                      'data-on': (axis.sensitivity ?? 'normal') === id ? '1' : '0',
                      onClick: () => patchAxes(key, { sensitivity: id }, `${label}灵敏度`),
                    }, text))),
                setHint(hint))
            }),
          ),
          h('details', { className: 'cyp-mem', 'data-panel': 'memory', open: true, style: panelStyle('memory') },
            h('summary', null,
              `记忆条目${Array.isArray(memories) ? `（${memories.length} 条）` : ''}`),
            h('p', { className: 'cyp-hint' },
              '这些会参与记忆回访和主动开口。固定下来的条目不会随时间淡掉，忘掉的会立刻从她的小本子里消失。'),
            Number(state.memoryFirstWriteAt) > 0 && state.memoryNoticeDismissed !== true
              ? h('div', { className: 'cyp-notice' },
                  h('span', null, '她第一次把你的事记进了加密的小本子。'),
                  h('button', {
                    type: 'button',
                    className: 'cyp-mini',
                    disabled: busy !== '',
                    onClick: () => saveMemorySettings({ memoryNoticeDismissed: true }, '收下提示'),
                  }, '知道啦'))
              : null,
            h('label', { className: 'cyp-toggle' },
              h('input', {
                type: 'checkbox',
                checked: state.memoryEnabled !== false,
                disabled: busy !== '',
                onChange: (event) => saveMemorySettings(
                  { memoryEnabled: event.target.checked },
                  event.target.checked ? '打开自动记忆' : '关闭自动记忆',
                ),
              }),
              h('span', null, '自动记住你说的事')),
            h('p', { className: 'cyp-hint' },
              state.memoryEnabled === false
                ? '现在只记得你手动写下的条目，会话里的内容不会自动进来。'
                : '默认开启，每轮最多收 4 条；只保存在本机加密仓库，可随时导出或整份恢复。'),
            state.memoryVaultError
              ? h('p', { className: 'cyp-status' }, `记忆仓库还没解锁：${state.memoryVaultError}`)
              : null,
            memories === null
              ? h('p', { className: 'cyp-hint' }, '正在翻她的小本子…')
              : memories.length === 0
                ? h('p', { className: 'cyp-hint' }, '还没记住什么。下面写一句，她就会收好。')
                : h('div', { className: 'cyp-mem-list' },
                    memories.slice(0, 20).map((item) =>
                      h('div', { key: item.id, className: 'cyp-mem-item' },
                        h('span', { className: 'cyp-chip' }, SLOT_LABELS[item.slot] ?? '记忆'),
                        h('span', { className: 'cyp-mem-text' }, item.text),
                        h('button', {
                          type: 'button',
                          className: 'cyp-mini',
                          disabled: memBusy !== '',
                          onClick: () => memoryAction(
                            MEMORY_PIN_PATH,
                            { id: item.id, pinned: item.pinned !== true },
                            item.pinned === true ? '取消固定' : '固定',
                          ),
                        }, item.pinned === true ? '取消固定' : '固定'),
                        h('button', {
                          type: 'button',
                          className: 'cyp-mini',
                          disabled: memBusy !== '',
                          onClick: () => {
                            if (window.confirm('要让她忘掉这条吗？')) {
                              memoryAction(MEMORY_FORGET_PATH, { id: item.id }, '忘掉')
                            }
                          },
                        }, '忘掉')))),
            h('div', { className: 'cyp-mem-form' },
              h('select', {
                className: 'cyp-select',
                value: memSlot,
                onChange: (event) => setMemSlot(event.target.value),
              }, ['identity', 'preference', 'event', 'relation'].map((slot) =>
                h('option', { key: slot, value: slot }, SLOT_LABELS[slot]))),
              h('input', {
                className: 'cyp-input',
                type: 'text',
                maxLength: 400,
                placeholder: '让她记住一件事…',
                value: memText,
                onChange: (event) => setMemText(event.target.value),
              }),
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: memBusy !== '' || memText.trim() === '',
                onClick: () => memoryAction(
                  MEMORY_PATH,
                  { text: memText.trim(), slot: memSlot },
                  '记下',
                  true,
                ),
              }, '记下')),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: memBusy !== '',
                onClick: loadMemories,
              }, '刷新列表'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: memBusy !== '',
                onClick: exportMemory,
              }, '导出备份'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: memBusy !== '',
                onClick: () => importRef.current?.click(),
              }, '从备份恢复'),
              h('input', {
                ref: importRef,
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: importMemory,
              }),
              memStatus === ''
                ? null
                : h('span', { className: 'cyp-status' }, memStatus))),
          h('details', { className: 'cyp-look', 'data-panel': 'gallery', open: true, style: panelStyle('gallery') },
            h('summary', null,
              `背景库与配色${usedSlotCount > 0 ? `（${usedSlotCount} 处已选图）` : '（还没选图）'}`),
            h('p', { className: 'cyp-hint' },
              '图都存在你自己的盘上，删掉只动这一份。四处背景各选各的，互不影响。'),
            sectionTitle('铺到哪一处', '先选位置，再挑图。换个位置调的是另一套取景。'),
            h('div', { className: 'cyp-row' },
              bgSlotNames.map((name) =>
                h('button', {
                  key: name,
                  type: 'button',
                  className: 'cyp-chip',
                  'data-active': lookSlot === name ? '1' : '0',
                  onClick: () => setLookSlot(name),
                }, slotLabel(name)))),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: lookBusy !== '',
                onClick: () => bgFileRef.current?.click(),
              }, lookBusy === '' ? `收一张图给「${slotLabel(lookSlot)}」` : lookBusy),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: lookBusy !== '' || (slotNow.id ?? '') === '',
                onClick: clearSlot,
              }, '这一处不要了'),
              h('input', {
                ref: bgFileRef,
                type: 'file',
                accept: 'image/*',
                style: { display: 'none' },
                onChange: (event) => {
                  uploadChatBg(event.target.files)
                  event.target.value = ''
                },
              }),
              lookStatus === ''
                ? null
                : h('span', { className: 'cyp-status' }, lookStatus)),
            /* 取景：拖动挪画面，滚轮或滑杆放大；松手才写进设置。 */
            (slotNow.id ?? '') !== ''
              ? h('div', { className: 'cyp-crop' },
                  h('div', { className: 'cyp-crop-head' },
                    h('span', { className: 'cyp-hint' }, '取景'),
                    h('span', { className: 'cyp-status' },
                      `${lookPos.x}% · ${lookPos.y}% · ${lookZoom.toFixed(2)}×`)),
                  h('div', {
                    className: 'cyp-crop-preview',
                    onPointerDown: (event) => {
                      if (event.button !== 0) return
                      event.preventDefault()
                      const box = event.currentTarget.getBoundingClientRect()
                      const startX = event.clientX
                      const startY = event.clientY
                      const base = { x: lookPos.x, y: lookPos.y }
                      let latest = base
                      const move = (ev) => {
                        /* 往右拖，取景锚点往左收；放大之后同样位移对应更小的百分比变化 */
                        const dx = ((ev.clientX - startX) / Math.max(1, box.width)) * 100 / lookZoom
                        const dy = ((ev.clientY - startY) / Math.max(1, box.height)) * 100 / lookZoom
                        latest = {
                          x: Math.round(Math.min(100, Math.max(0, base.x - dx))),
                          y: Math.round(Math.min(100, Math.max(0, base.y - dy))),
                        }
                        previewSlot({ posX: latest.x, posY: latest.y })
                      }
                      const up = () => {
                        window.removeEventListener('pointermove', move)
                        window.removeEventListener('pointerup', up)
                        saveSlot({ posX: latest.x, posY: latest.y }, '正在记住这个取景…')
                      }
                      window.addEventListener('pointermove', move)
                      window.addEventListener('pointerup', up)
                    },
                    onWheel: (event) => {
                      event.preventDefault()
                      const next = Math.min(3, Math.max(1,
                        Math.round((lookZoom + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100))
                      previewSlot({ zoom: next })
                      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
                      zoomTimerRef.current = setTimeout(() => {
                        saveSlot({ zoom: next }, '正在记住这个缩放…')
                      }, 500)
                    },
                  },
                    h('img', {
                      src: `${BACKGROUND_PATH}/${encodeURIComponent(slotNow.id)}`,
                      alt: '',
                      draggable: false,
                      style: {
                        objectPosition: `${lookPos.x}% ${lookPos.y}%`,
                        transform: `scale(${lookZoom})`,
                        transformOrigin: `${lookPos.x}% ${lookPos.y}%`,
                        filter: lookBlur > 0 ? `blur(${Math.min(4, lookBlur / 5)}px)` : 'none',
                      },
                    }),
                    h('div', {
                      className: 'cyp-crop-shade',
                      style: { background: `rgba(255, 250, 253, ${lookDim})` },
                    }),
                    h('span', { className: 'cyp-crop-tip' }, '拖动换取景 · 滚轮缩放')),
                  h('label', { className: 'cyp-row' },
                    h('span', { className: 'cyp-hint' }, `放大 ${lookZoom.toFixed(2)}×`),
                    h('input', {
                      className: 'cyp-range',
                      type: 'range',
                      min: 1,
                      max: 3,
                      step: 0.05,
                      value: lookZoom,
                      onChange: (event) => previewSlot({ zoom: Number(event.target.value) }),
                      onPointerUp: (event) => saveSlot(
                        { zoom: Number(event.currentTarget.value) }, '正在记住这个缩放…'),
                      onKeyUp: (event) => saveSlot(
                        { zoom: Number(event.currentTarget.value) }, '正在记住这个缩放…'),
                    })),
                  h('label', { className: 'cyp-row' },
                    h('span', { className: 'cyp-hint' }, `遮罩 ${Math.round(lookDim * 100)}%`),
                    h('input', {
                      className: 'cyp-range',
                      type: 'range',
                      min: 0,
                      max: 0.85,
                      step: 0.05,
                      value: lookDim,
                      onChange: (event) => previewSlot({ dim: Number(event.target.value) }),
                      onPointerUp: (event) => saveSlot(
                        { dim: Number(event.currentTarget.value) }, '正在记住遮罩…'),
                      onKeyUp: (event) => saveSlot(
                        { dim: Number(event.currentTarget.value) }, '正在记住遮罩…'),
                    })),
                  h('label', { className: 'cyp-row' },
                    h('span', { className: 'cyp-hint' }, `模糊 ${lookBlur}px`),
                    h('input', {
                      className: 'cyp-range',
                      type: 'range',
                      min: 0,
                      max: 24,
                      step: 1,
                      value: lookBlur,
                      onChange: (event) => previewBlur(Number(event.target.value)),
                      onPointerUp: (event) => saveLookBlur(Number(event.currentTarget.value)),
                      onKeyUp: (event) => saveLookBlur(Number(event.currentTarget.value)),
                    })),
                  h('div', { className: 'cyp-crop-grid' },
                    [[0, 0, '↖'], [50, 0, '↑'], [100, 0, '↗'],
                     [0, 50, '←'], [50, 50, '·'], [100, 50, '→'],
                     [0, 100, '↙'], [50, 100, '↓'], [100, 100, '↘']]
                      .map(([x, y, label]) =>
                        h('button', {
                          key: `${x}-${y}`,
                          type: 'button',
                          className: 'cyp-crop-dot',
                          'data-active': lookPos.x === x && lookPos.y === y ? '1' : '0',
                          disabled: lookBusy !== '',
                          onClick: () => saveLookPos({ x, y }),
                        }, label))))
              : null,
            sectionTitle('图库', '从同一份清单里挑；同一张可以同时给几处用。'),
            chatLook.items.length === 0
              ? h('div', { className: 'cyp-bg-empty' },
                  h('span', { className: 'cyp-hint' }, '还没收过图，上面挑一张吧。'))
              : h('div', { className: 'cyp-bg-grid' },
                  chatLook.items.map((item) =>
                    h('div', {
                      key: item.id,
                      className: 'cyp-bg-tile',
                      'data-active': (slotNow.id ?? '') === item.id ? '1' : '0',
                      onClick: () => {
                        if (lookBusy === '') useChatBg(item.id)
                      },
                    },
                      h('img', {
                        src: `${BACKGROUND_PATH}/${encodeURIComponent(item.id)}`,
                        alt: '',
                        loading: 'lazy',
                      }),
                      h('span', { className: 'cyp-bg-tile-name' }, item.name ?? item.id),
                      h('button', {
                        type: 'button',
                        className: 'cyp-bg-tile-del',
                        title: '从库里删掉',
                        disabled: lookBusy !== '',
                        onClick: (event) => {
                          event.stopPropagation()
                          deleteFromLibrary(item.id)
                        },
                      }, '×')))),
            h('div', { className: 'cyp-look-group' },
              h('div', { className: 'cyp-row' },
                h('span', { className: 'cyp-hint' }, '主题颜色'),
                PALETTE_OPTIONS.map((item) =>
                  h('button', {
                    key: item.id,
                    type: 'button',
                    className: 'cyp-chip',
                    'data-active': (state?.appearance?.palette ?? 'sakura') === item.id ? '1' : '0',
                    disabled: lookBusy !== '',
                    onClick: () => savePalette(item.id),
                  }, item.label))),
              h('p', { className: 'cyp-hint' },
                '配色会同时换掉 DSH 的侧栏、面板和气泡底色，不只是桌宠自己。'),
            ),
            h('div', { className: 'cyp-look-group' },
              h('div', { className: 'cyp-row' },
                h('span', { className: 'cyp-hint' }, '主题颜色'),
                PALETTE_OPTIONS.map((item) =>
                  h('button', {
                    key: item.id,
                    type: 'button',
                    className: 'cyp-chip',
                    'data-active': (state?.appearance?.palette ?? 'sakura') === item.id ? '1' : '0',
                    disabled: lookBusy !== '',
                    onClick: () => savePalette(item.id),
                  }, item.label))),
              h('p', { className: 'cyp-hint' },
                '配色会同时换掉 DSH 的侧栏、面板和气泡底色，不只是桌宠自己。'),
              chatLook.items.length === 0
                ? h('p', { className: 'cyp-hint' }, '还没铺过图，上面挑一张吧。')
                : h('div', { className: 'cyp-bg-strip' },
                    chatLook.items.map((item) =>
                      h('button', {
                        key: item.id,
                        type: 'button',
                        className: 'cyp-bg-chip',
                        'data-active': chatLook.active?.id === item.id ? '1' : '0',
                        disabled: lookBusy !== '',
                        onClick: () => useChatBg(item.id),
                      }, h('img', {
                        src: `${BACKGROUND_PATH}/${encodeURIComponent(item.id)}`,
                        alt: '',
                        loading: 'lazy',
                      })))))),
          h('details', { className: 'cyp-stickers', 'data-panel': 'sticker', style: panelStyle('sticker') },
            h('summary', null,
              `表情包${Array.isArray(customStickers) ? `（自定义 ${customStickers.length} 张）` : ''}`),
            h('p', { className: 'cyp-hint' },
              '内置表情和自己收的图共用一份清单。这里收的图，聊天里也能直接贴；同内容只留一份。'),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: stickerBusy !== '',
                onClick: () => stickerBatchRef.current?.click(),
              }, stickerBusy === '' ? '选图上传' : stickerBusy),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: stickerBusy !== '',
                onClick: loadCustomStickers,
              }, '刷新'),
              h('input', {
                ref: stickerBatchRef,
                type: 'file',
                accept: 'image/*',
                multiple: true,
                style: { display: 'none' },
                onChange: (event) => {
                  uploadStickers(event.target.files)
                  event.target.value = ''
                },
              }),
              stickerStatus === ''
                ? null
                : h('span', { className: 'cyp-status' }, stickerStatus)),
            h('p', { className: 'cyp-hint' },
              '一次可以选多张，把从群里存下来的那批一起选上也行。单张最大 8MB。'),
            customStickers === null
              ? h('p', { className: 'cyp-hint' }, '正在翻她的表情包…')
              : customStickers.length === 0
                ? h('p', { className: 'cyp-hint' }, '还没收过自己的图，上面挑几张吧。')
                : h('div', { className: 'cyp-sticker-grid' },
                    customStickers.slice(0, 60).map((item) =>
                      h('div', { key: item.id, className: 'cyp-sticker-card' },
                        item.href === ''
                          ? h('div', { className: 'cyp-sticker-thumb' }, '图')
                          : h('img', {
                              className: 'cyp-sticker-thumb',
                              src: item.href,
                              alt: item.label || item.name,
                              loading: 'lazy',
                            }),
                        h('span', { className: 'cyp-sticker-name' }, item.label || item.name),
                        h('div', { className: 'cyp-row' },
                          h('button', {
                            type: 'button',
                            className: 'cyp-mini',
                            disabled: stickerBusy !== '',
                            onClick: () => renameSticker(item),
                          }, '改名'),
                          h('button', {
                            type: 'button',
                            className: 'cyp-mini',
                            disabled: stickerBusy !== '',
                            onClick: () => deleteSticker(item),
                          }, '删除')))))),
          h('details', { className: 'cyp-vision', 'data-panel': 'vision', style: panelStyle('vision') },
            h('summary', null, '表情自动识别'),
            h('p', { className: 'cyp-hint' },
              '打开后，自动收下的表情会交给视觉模型起一两个短标签，之后才能按情绪挑。没配置、超时或报错都会跳过，不影响正常收图。'),
            h('label', { className: 'cyp-toggle' },
              h('input', {
                type: 'checkbox',
                checked: vision.enabled === true,
                disabled: visionBusy !== '',
                onChange: (event) => setVision((prev) => ({ ...prev, enabled: event.target.checked })),
              }),
              h('span', null, '用视觉模型自动打标签')),
            h('div', { className: 'cyp-mem-form' },
              h('input', {
                className: 'cyp-input',
                type: 'text',
                maxLength: 300,
                placeholder: '接口地址，例如 https://api.deepseek.com',
                value: vision.baseUrl,
                onChange: (event) => setVision((prev) => ({ ...prev, baseUrl: event.target.value })),
              }),
              h('input', {
                className: 'cyp-input',
                type: 'text',
                maxLength: 100,
                placeholder: '模型名',
                value: vision.model,
                onChange: (event) => setVision((prev) => ({ ...prev, model: event.target.value })),
              })),
            h('div', { className: 'cyp-mem-form' },
              h('input', {
                className: 'cyp-input',
                type: 'password',
                maxLength: 300,
                placeholder: state.vision?.hasApiKey === true ? '已经存好 Key，留空就不改' : '视觉模型 API Key',
                value: vision.apiKey,
                onChange: (event) => setVision((prev) => ({ ...prev, apiKey: event.target.value })),
              }),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: visionBusy !== '',
                onClick: () => saveVision(false),
              }, '保存'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: visionBusy !== '',
                onClick: testVision,
              }, visionBusy === 'test' ? '连接中…' : '测试连接'),
              state.vision?.hasApiKey === true
                ? h('button', {
                    type: 'button',
                    className: 'cyp-mini',
                    disabled: visionBusy !== '',
                    onClick: () => {
                      if (window.confirm('要清掉已经保存的视觉模型 Key 吗？')) saveVision(true)
                    },
                  }, '清掉 Key')
                : null),
            h('p', { className: 'cyp-note' },
              '地址填到 /chat/completions 之前就行，填完整接口也认；Key 留空会复用桌宠已经存好的 DeepSeek Key。Key 只进本机加密仓库，state.json 里只记「有没有填过」。'),
            visionStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, visionStatus)),
          /* ---------------- 亲密层 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'intimacy', style: panelStyle('intimacy') },
            h('p', { className: 'cyp-hint' }, '这一层默认关着；打开后才有节奏和门槛。'),
            h('div', { className: 'cyp-set' },
              h('div', { className: 'cyp-set-head' },
                h('span', { className: 'cyp-set-label' }, '启用亲密层'),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': state?.intimacy?.enabled === true ? '1' : '0',
                  onClick: () => patchIntimacy(
                    { enabled: state?.intimacy?.enabled !== true },
                    '亲密层',
                  ),
                })),
              setHint('公开版无论怎么开都不会生效，这里只对本地版有用。')),
            setRange('每天次数', 'intimacyPerDay', 1, 8, 1, '一天最多几次。', (v) => `${v} 次`,
              (v) => patchIntimacy({ perDay: v }, '每天次数')),
          ),
          /* ---------------- 节奏 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'intimacy', style: panelStyle('intimacy') },
            h('p', { className: 'cyp-hint' }, '什么时候才轮得到、一次能延续多久。'),
            setRange('冷却', 'intimacyCooldown', 1, 24, 1, '两次之间至少隔多久。', (v) => `${v} 小时`,
              (v) => patchIntimacy({ cooldownHours: v }, '冷却')),
            setRange('闲置触发', 'intimacyIdle', 1, 24, 1, '安静多久之后才可能被提起。', (v) => `${v} 小时`,
              (v) => patchIntimacy({ idleHours: v }, '闲置触发')),
            setRange('事后关怀', 'intimacyAftercare', 5, 240, 5, '结束后的温柔时段有多长。', (v) => `${v} 分钟`,
              (v) => patchIntimacy({ aftercareMinutes: v }, '事后关怀')),
          ),
          /* ---------------- 语音 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'voice', style: panelStyle('voice') },
            h('p', { className: 'cyp-hint' }, '桌宠说话时要不要念出声。'),
            String(state.ttsEndpoint ?? '').trim() === ''
              ? h('p', { className: 'cyp-note' }, 'TTS 地址空着，就不摆「念出声」这一项；填上地址再决定要不要她出声。')
              : setToggle('念出声', 'speechEnabled', '打开后气泡里的话会用语音读一遍。'),
            setSeg('语音引擎', 'speechProvider', [['system', '系统语音'], ['local', 'GPT-SoVITS（本机）']],
              'GPT-SoVITS 需要先把本地服务跑起来，再填下面的地址。'),
            setText('TTS 地址', 'ttsEndpoint', 'http://127.0.0.1:9880', '本地 GPT-SoVITS 的接口地址。'),
          ),
          /* ---------------- 音色 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'voice', style: panelStyle('voice') },
            h('p', { className: 'cyp-hint' }, '换成她自己的声音，以及说话多大声。'),
            setText('参考音频', 'ttsRefAudio', '留空用默认音色', '给音色克隆用的一段音频路径。', 500),
            setText('参考文本', 'ttsPromptText', '留空则不提交', '参考音频对应的文字，GPT-SoVITS 靠它对齐音色与语气。', 500),
            setRange('音量', 'soundVolume', 0, 1, 0.05, '拖到 0 就等于静音。', (v) => `${Math.round(v * 100)}%`),
          ),
          /* ---------------- QQ ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'qq', style: panelStyle('qq') },
            h('p', { className: 'cyp-hint' }, 'QQ 官方通道的连接与语音回复。'),
            h('div', { className: 'cyp-set' },
              h('div', { className: 'cyp-set-head' },
                h('span', { className: 'cyp-set-label' }, '启用 QQ 通道'),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': state?.qq?.enabled === true ? '1' : '0',
                  onClick: () => patchQq({ enabled: state?.qq?.enabled !== true }, 'QQ 通道'),
                })),
              setHint('AppSecret 存在单独的加密文件里，这里只放非敏感配置。')),
            h('div', { className: 'cyp-set' },
              h('div', { className: 'cyp-set-head' },
                h('span', { className: 'cyp-set-label' }, '隐私模式'),
                h('button', {
                  type: 'button',
                  className: 'cyp-switch',
                  'data-on': state?.qq?.privacyMode !== false ? '1' : '0',
                  onClick: () => patchQq(
                    { privacyMode: state?.qq?.privacyMode === false },
                    '隐私模式',
                  ),
                })),
              setHint('开着时群聊和陌生私聊的记忆不上桌面，也不跨会话串味。')),
            h('div', { className: 'cyp-set' },
              h('span', { className: 'cyp-set-label' }, 'AppID'),
              h('input', {
                type: 'text',
                className: 'cyp-input',
                defaultValue: String(state?.qq?.appId ?? ''),
                placeholder: 'QQ 开放平台的 AppID',
                onBlur: (event) => {
                  const next = event.currentTarget.value.trim()
                  if (next !== String(state?.qq?.appId ?? '')) patchQq({ appId: next }, 'AppID')
                },
              })),
            setArea('主人 openid', (Array.isArray(state?.qq?.ownerOpenIds) ? state.qq.ownerOpenIds : []).join('\n'),
              (v) => patchQq({
                ownerOpenIds: v.split(/[\n,，;；]+/).map((item) => item.trim()).filter((item) => item !== ''),
              }, '主人 openid'),
              '一行一个；这些人说话才算「主人」身份。', 3),
            setToggle('允许 QQ 语音', 'qqVoiceEnabled', '私聊里可以让她补一条语音。'),
            setSeg('什么时候发', 'qqVoiceMode', [['always', '每条都配'], ['wakeWord', '叫了名字才配']],
              '群聊一律不发语音，避免被所有人点开。'),
            setText('触发词', 'qqVoiceWakeWord', '发句语音', '说到这个词就补一条语音，最长 32 字。', 32),
          ),
          /* ---------------- 数据 ---------------- */
          h('div', { className: 'cyp-panel', 'data-panel': 'data', style: panelStyle('data') },
            h('p', { className: 'cyp-hint' }, '余额提醒、今日额度与多端同步。'),
            setNumber('余额提醒阈值', 'balanceThreshold', 0, 100000, 1, '低于这个数就在气泡里提醒你。'),
            setNumber('今日额度', 'dailyLimit', 0, 100000, 1, '0 表示不设上限。'),
            setNumber('余额刷新间隔', 'refreshSeconds', 15, 300, 5, '多久拉一次余额，15 到 300 秒。'),
            setToggle('双端设置同步', 'settingsSync',
              '桌宠设置窗与这里共用昵称、气泡、语音、QQ 等同一组字段；关掉后两套界面各写各的。'),
            setText('同步令牌', 'syncToken', '留空关闭多端同步', '填了才开 /sync 端点，别用太弱的串。', 128),
          ),
          h('details', { className: 'cyp-backup', 'data-panel': 'data', open: true, style: panelStyle('data') },
            h('summary', null, '数据备份与密钥'),
            h('p', { className: 'cyp-hint' },
              '设置、记忆、好感、身体状态和最近开口都会一起打包。API Key、模型文件和语音缓存不会进备份。'),
            h('div', { className: 'cyp-row' },
              h('input', {
                className: 'cyp-input',
                type: 'password',
                placeholder: '备份口令（至少 8 个字符）',
                value: backupPassphrase,
                disabled: backupBusy !== '',
                onChange: (event) => setBackupPassphrase(event.target.value),
              }),
              h('label', { className: 'cyp-toggle' },
                h('input', {
                  type: 'checkbox',
                  checked: backupEncrypted,
                  disabled: backupBusy !== '',
                  onChange: (event) => setBackupEncrypted(event.target.checked),
                }),
                h('span', null, '用口令加密')),
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: backupBusy !== '',
                onClick: exportFullBackup,
              }, backupBusy === 'export' ? '导出中…' : '导出整库'),
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: backupBusy !== '',
                onClick: () => backupFileRef.current?.click(),
              }, '恢复整库'),
              h('input', {
                ref: backupFileRef,
                type: 'file',
                accept: 'application/json,.json',
                style: { display: 'none' },
                onChange: restoreFullBackup,
              })),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: backupBusy !== '',
                onClick: rotateVaultKeys,
              }, backupBusy === 'rotate' ? '轮换中…' : '轮换本机密钥'),
              h('span', { className: 'cyp-hint' }, '轮换只换本机加密材料，数据保留。')),
            backupStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, backupStatus)),
          h('details', { className: 'cyp-peers', 'data-panel': 'peers', style: panelStyle('peers') },
            h('summary', null, '联系人身份'),
            h('p', { className: 'cyp-hint' },
              '被点到名字的人说话时，好感起点不一样：主人 60~70、重要 50~60、次重要 30~40。一行一个，逗号也当分隔。'),
            h('label', { className: 'cyp-label' }, '主人'),
            h('textarea', {
              className: 'cyp-textarea',
              rows: 2,
              placeholder: 'qq:private:<openid>',
              value: peerText.owner,
              disabled: peerBusy !== '',
              onChange: (event) => setPeerText((prev) => ({ ...prev, owner: event.target.value })),
            }),
            h('label', { className: 'cyp-label' }, '重要的人'),
            h('textarea', {
              className: 'cyp-textarea',
              rows: 2,
              placeholder: 'qq:private:<openid>',
              value: peerText.important,
              disabled: peerBusy !== '',
              onChange: (event) => setPeerText((prev) => ({ ...prev, important: event.target.value })),
            }),
            h('label', { className: 'cyp-label' }, '次重要'),
            h('textarea', {
              className: 'cyp-textarea',
              rows: 2,
              placeholder: 'qq:group:<群id>#<发送者 openid>',
              value: peerText.secondary,
              disabled: peerBusy !== '',
              onChange: (event) => setPeerText((prev) => ({ ...prev, secondary: event.target.value })),
            }),
            h('p', { className: 'cyp-note' },
              '私聊写 qq:private:<openid>，群聊写 qq:group:<群id>#<发送者 openid>。键写错了不会报错，只是认不出这个人。'),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-btn',
                'data-tone': 'primary',
                disabled: peerBusy !== '',
                onClick: savePeers,
              }, peerBusy === 'save' ? '保存中…' : '保存名单')),
            peerStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, peerStatus)),
          h('details', { className: 'cyp-peers', 'data-panel': 'qq', style: panelStyle('qq') },
            h('summary', null, 'QQ 语音回复'),
            h('p', { className: 'cyp-hint' },
              '私聊里说到触发词，文字发完再补一条语音。群聊不发——一条语音在群里能被所有人点开。'),
            h('label', { className: 'cyp-row' },
              h('input', {
                type: 'checkbox',
                checked: state?.qqVoiceEnabled === true,
                disabled: qqVoiceBusy !== '',
                onChange: (event) => saveQqVoice({ qqVoiceEnabled: event.target.checked }),
              }),
              h('span', null, '在 QQ 里补发语音（默认关）')),
            h('label', { className: 'cyp-label' }, '触发词'),
            h('input', {
              className: 'cyp-input',
              type: 'text',
              maxLength: 32,
              placeholder: '发句语音',
              value: qqVoiceText,
              disabled: qqVoiceBusy !== '',
              onChange: (event) => setQqVoiceText(event.target.value),
              onBlur: () => {
                const text = qqVoiceText.trim()
                if (text === '' || text === (state?.qqVoiceWakeWord ?? '')) return
                saveQqVoice({ qqVoiceWakeWord: text })
              },
            }),
            h('p', { className: 'cyp-note' },
              '和叫名字分开：叫名字只让她听见，说这几个字才让她开口。可以用顿号写几个。'),
            h('div', { className: 'cyp-row' },
              h('button', {
                type: 'button',
                className: 'cyp-mini',
                disabled: qqVoiceBusy !== '',
                onClick: () => saveQqVoice({ qqVoiceMode: state?.qqVoiceMode === 'always' ? 'wakeWord' : 'always' }),
              }, state?.qqVoiceMode === 'always' ? '每次都发（点一下改成只在说到时发）' : '只在说到时发（点一下改成每次都发）')),
            qqVoiceStatus === ''
              ? null
              : h('p', { className: 'cyp-status' }, qqVoiceStatus)),
          h('details', { className: 'cyp-game', 'data-panel': 'rps', style: panelStyle('rps') },
            h('summary', null,
              `互动小游戏${ability && ability.summary ? `（已玩 ${ability.summary.total} 局）` : ''}`),
            h('p', { className: 'cyp-hint' },
              '石头剪刀布，战绩只留在本机。'),
            ability === null
              ? h('p', { className: 'cyp-hint' }, abilityStatus || '正在翻战绩…')
              : h('div', { className: 'cyp-companion' },
                  h('span', { className: 'cyp-chip' },
                    ability.summary ? ability.summary.label : '还没交过手'),
                  h('span', { className: 'cyp-chip' },
                    `${Number(ability.summary?.win) || 0} 胜 / ${Number(ability.summary?.lose) || 0} 负 / ${Number(ability.summary?.draw) || 0} 平`),
                  h('span', { className: 'cyp-chip' },
                    `胜率 ${Number(ability.summary?.winRate) || 0}%`),
                  ability.summary && ability.summary.streak > 0
                    ? h('span', { className: 'cyp-chip' }, `连胜 ${ability.summary.streak}`)
                    : null),
            lastRound === null
              ? null
              : h('p', { className: 'cyp-game-result', 'data-result': lastRound.result },
                  `你出 ${RPS_LABELS[lastRound.user] ?? '？'}，她出 ${RPS_LABELS[lastRound.pet] ?? '？'}，${
                    lastRound.result === 'win'
                      ? '这局你赢啦 ♪'
                      : lastRound.result === 'lose'
                        ? '这局她赢了呢。'
                        : '平局，心有灵犀？'
                  }`),
            h('div', { className: 'cyp-row' },
              RPS_OPTIONS.map((option) =>
                h('button', {
                  key: option.id,
                  type: 'button',
                  className: 'cyp-btn',
                  disabled: abilityBusy !== '',
                  onClick: () => playAbility(option.id),
                }, `${option.mark} ${option.label}`))),
            abilityStatus === '' || ability === null
              ? null
              : h('p', { className: 'cyp-status' }, abilityStatus)),
          status === ''
            ? null
            : h('p', { className: 'cyp-status', 'data-tone': tone }, status))))
      }

      try {
        ctx.slots.inject('settings.section', () => {
          try {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'cyrene-pet',
              order: 32,
              label: () => '昔涟 · 桌宠',
            }, PetSection)
          } catch (error) {
            log('warn', '设置页槽位注册失败，跳过（不影响其他插件）', error)
            return () => {}
          }
        })
      } catch (error) {
        log('warn', '设置页槽位注入失败，跳过（不影响其他插件）', error)
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'theme']
    return module.exports
  },
})
