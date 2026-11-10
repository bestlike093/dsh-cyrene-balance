# 素材授权与使用边界

## 来源

`assets/cyrene` 下的立绘与表情来自 `bestlike093/cyrene-balance`（见下方「内置默认素材」）。`assets/sticker-packs/cyrene-agent` 是可直接发到 QQ 的内置表情包，同样取自 `cyrene-balance`。早期自制的 whale-girl 系列素材已全部删除，不再随包，也不再出现在素材库里。

## 使用范围

- 默认素材只用 `assets/cyrene` 里的立绘、帧、表情与贴纸。
- `sticker-packs/` 属于可选素材，只在用户主动选择或表情面板里出现，不替换默认立绘。
- 完整 Live2D 形象需要另行提供分层源文件；模型文件不得随包，只能由用户导入到 `userData/models`。

## 目录分工

- `assets/` 只放运行时真正要读的文件：`cyrene/` 默认素材、`sticker-packs/` 可选素材，以及这份说明。`electron-builder` 打包 `assets/**`，这里的每个文件都会进发布包。
- `electron-builder.yml` 额外排除 `*.moc3`、`*.model3.json`、`*.physics3.json`、`*.motion3.json`，`scripts/check-package.mjs` 会对产物再做一次断言。

## 发布限制

- 自制素材可以随包，但每次发布前需要在发布清单里确认一次；不能因为「已经进了仓库」就默认进发布包。
- 第三方版权素材与任何模型文件（`.moc3` / `.model3.json` / 纹理目录）不得进入发布包。
- `samples/`、`ref/`、`preview.html`、`broken-404*` 不属于运行时素材，`scripts/check-assets-license.mjs` 一旦在 `assets/` 下发现它们就直接判失败。
- `bestlike093` 自绘/自制的素材可由本项目自由使用、修改并随包分发，不再逐次确认；对外二次分发仍以原作者的说明为准。

## 内置默认素材：assets/cyrene

`assets/cyrene` 下的立绘、帧、状态栏头像、表情贴纸、音效与循环贴纸来自 `bestlike093/cyrene-balance`（commit `c54d9f6`），均为原作者自绘/自制。

仓库里放的是压缩后的运行时副本：立绘与帧缩到 512px 高、表情缩到 128px 高，原始 zip 不入库。压缩脚本见 `scripts/prepare-cyrene-assets.ps1`。

### 应用图标与托盘图标：assets/cyrene/icons

`tray.ico` 与 `app-cyrene.png` 取自 Cyrene 本体安装包（`D:\cyrene\resources\app.asar` 的 `assets/tray-icon.ico` 与 `assets/icon-presets/cyrene-pink.png`），为原作者自绘素材。用于托盘、窗口与任务栏图标，随本项目桌面端一起分发。

⚠️ 本体里的 `assets/icons/vscode/*.svg`（37 个文件类型图标）是第三方图标集，**不属于本组素材，未接入本项目，也不得随包分发**。

- 授权：`bestlike093` 已确认 `cyrene-balance` 是其自有仓库，其中自绘/自制素材可由本项目自由使用、修改并随包分发。
- 对外边界：素材本身不单独售卖；向本项目之外的第三方再分发时，仍以原作者的说明为准。
- 用户自行导入的模型与素材仍走 `userData/models`、`userData/packs`，与这组默认素材互不影响，也不会被覆盖。


## 新增素材的规矩

新增目录前先在这里补一行来源与授权说明，再放图片。`scripts/check-assets-license.mjs` 会核对目录名是否出现在本文件中，没有说明的目录直接判失败。
